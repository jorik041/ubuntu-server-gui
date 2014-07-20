define(['backbone', 'App', 'views/modal/FileOpsNotice'], function (Backbone, App, FileOpsNotice) {

    return Backbone.Model.extend({
        defaults: {
            connection_status: undefined,
            ssh_password: '',
            sshProxy: undefined,
        },

        initialize: function(attributes, options) {
            if(typeof options.server === "undefined") {
                throw "Expected server to be provided.";
            }
            this.server = options.server;
            this.server.connection = this;
        },

        connect: function(callback) {
            callback = _.isFunction(callback) ? callback : function() {};
            if(typeof process === 'undefined') {
                throw 'cannot connect to a server from a web browser';
            }

            this.set('connection_status', 'connecting');
            if((this.server.get('keyPath') !== null) || this.get('ssh_password') !== '') { // typeof this.get('ssh_password') !== 'undefined') {
                this.initiateLocalProxy(callback);
            } else if(this.get('ssh_password') === '') {
                this.set('connection_status', 'password required');
                callback();
            }
        },

        disconnect: function(callback) {
            callback = _.isFunction(callback) ? callback : function() {};
            if(this.sshProxy && this.sshProxy._state !== 'closed') {
                try {
                    this.sshProxy.end();
                } catch(err) {
                    App.execute('log:error', {msg: 'SSH error trying to end sshProxy', severity: 'error', err: err});
                }
                callback();
            } else {
                callback();
            }
        },

        initiateLocalProxy: function(callback) {
            callback = _.isFunction(callback) ? callback : function() {};
            var SshConnection = require('ssh2');
            var sshProxy = this.sshProxy = new SshConnection();
            var connectOptions = {
//                debug: function(msg) {
//                    console.log(msg);
//                },
                host: this.server.get('ipv4'),
                port: this.server.get('port'),
                username: this.server.get('username')
            };

            sshProxy.on('ready', _.bind(function() {
//                connectOptions.password = undefined;
//                this.attributes.ssh_password = undefined;

                this.server.sshProxy = sshProxy;
                this.set('connection_status', 'connected');

                // also connect via sftp
                sshProxy.sftp(_.bind(function (err, sftpConnection) {
                    if (err) {
                        err['server-port'] = connectOptions['port'];
                        App.execute('log:error', {msg: 'SFTP Connection Error', severity: 'error', err: err});
                        throw err;
                    }
                    this.server.sftpProxy = this.sftpProxy = sftpConnection;

                    sftpConnection.on('end', function () {
                    });

                    sftpConnection.on('error', function (err) {
                        err['server-port'] = connectOptions['port'];
                        App.execute('log:error', {msg: 'SFTP Error', severity: 'error', err: err});
                    });

                    sftpConnection.on('timeout', function (err) {
                        err['server-port'] = connectOptions['port'];
                        App.execute('log:error', {msg: 'SFTP Timeout', severity: 'info', err: err});
                    });

                    App.vent.trigger('server:connected', this.server);
                    callback();
                }, this));

            }, this));

            //TODO: find a better place or logging and error trapping
            //TODO: decide how the app will handle sshProxy errors and disconnects
            sshProxy.on('error', _.bind(function(err) {
                err['server-port'] = connectOptions['port'];
                App.execute('log:error', {msg: 'SSH Error', severity: 'error', err: err});
                this.set('connection_status', 'connection error');
            }, this));

            sshProxy.on('end', function() {
                App.vent.trigger('server:disconnected', this.server);
            });

            sshProxy.on('close', function(had_error) {
                App.vent.trigger('server:closed', this.server);
            });

            sshProxy.on('timeout', function(err) {
                err['server-port'] = connectOptions['port'];
                App.execute('log:error', {msg: 'SSH Timeout', severity: 'info', err: err});
            });

            sshProxy.on('change password', function() {
                console.log('password change request');
            });

            sshProxy.on('banner', function(msg) {
            });

            sshProxy.usgExec = function (cmd, options, callback) {
                sshProxy.exec(cmd, options, function (err, sshStream) {
                    if (err) {
                        throw err;
                    }
                    sshStream.on('data', function (data, extended) {
                        callback(data.toString());
                    });
                });
            };

            if(this.server.get('keyPath') !== null) {
                try {
                    connectOptions.privateKey = require('fs').readFileSync(this.server.get('keyPath'));
                } catch(e) {
                    this.set('connection_status', 'ssh key error');
                    callback();
                }
            } else if(this.get('ssh_password')) {
                connectOptions.password = this.get('ssh_password');
            }

            try {
                sshProxy.connect(connectOptions);
            } catch(err) {
                this.set('connection_status', 'connection error');
                err['server-port'] = connectOptions['port'];
                App.execute('log:error', {msg: 'SSH Connection Error', severity: 'error', err: err});
                callback();
            }
        },

        readStream: function(filePath, callback) {
            if(typeof filePath === 'undefined') {
                throw 'filePath option required';
            }

            callback = _.isFunction(callback) ? callback : function() {};

            var StringDecoder = require('string_decoder').StringDecoder;
            var decoder = new StringDecoder('utf8');
            var fileContents = '';

            var fsStream = this.server.sftpProxy.createReadStream(filePath, {encoding: 'utf8'});

            fsStream.on('data', function(chunk) {
                fileContents += decoder.write(chunk);
            });

            fsStream.on('end', function() {
               callback(undefined, fileContents);
            });

            fsStream.on('error', function(err) {
                var errorMsg;
                switch(err.type) {
                    case 'NO_SUCH_FILE':
                        errorMsg = 'The file could not be found.'
                        break;
                    case 'PERMISSION_DENIED':
                        errorMsg = 'Insufficient permissions.'
                        break;
                    default:
                        errorMsg = 'Error reading file.';
                }
                App.execute('modal:show', new FileOpsNotice({errorMsg: errorMsg, filePath: filePath}));
                callback(err);
            });

            return fsStream;
        },

        writeStream: function(filePath, fileContents, options, callback) {
            if(typeof filePath === 'undefined' | typeof fileContents === 'undefined') {
                throw 'filePath and fileContens parameters are required';
            }

            if(typeof options === 'undefined') {
                options = {}
            }
            else if (typeof options === 'function' && typeof callback === 'undefined') {
                callback = options;
                options = {};
            };

            _.defaults(options, {encoding: 'utf8', autoClose: true, flags: 'w'});

            callback = typeof callback === 'function' ? callback : function() {};
            var wsStream = this.server.sftpProxy.createWriteStream(filePath, options);

//            wsStream.on('finish', function() {
//                callback();
//            });

            wsStream.on('error', function(err) {
                var errorMsg;
                switch(err.type) {
                    case 'NO_SUCH_FILE':
                        errorMsg = 'The file could not be found.'
                        break;
                    case 'PERMISSION_DENIED':
                        errorMsg = 'Insufficient permissions.'
                        break;
                    default:
                        errorMsg = 'Error saving file.';
                }
                App.execute('modal:show', new FileOpsNotice({errorMsg: errorMsg, filePath: filePath}));
                App.execute('log:error', {msg: 'Sever Connection File Write Stream Error', severity: 'error', err: err});
                callback(err);
            });

            wsStream.on('open', function() {
               var contentsBuffer = new Buffer(fileContents, 'utf8');
               wsStream.write(contentsBuffer, 'utf8', callback);
            });

            return wsStream;
        }

    });
});
