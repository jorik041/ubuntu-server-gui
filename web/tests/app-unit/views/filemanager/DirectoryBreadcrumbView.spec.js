define(function (requirejs) {
    var DirectoryBreadcrumbView = requirejs('views/filemanager/DirectoryBreadcrumbView'),
        DirectoryBreadcrumbs = requirejs('collections/DirectoryBreadcrumbs'),
        DirectoryExplorerModel = requirejs('models/DirectoryExplorer');


    describe('DirectoryBreadcrumbView', function() {
        var directoryBreadcrumbView;

        describe('onCrumbClick', function() {
            var mockClickedCrumbObj, setPathSpy;
            var directoryExplorerModel;

            beforeEach(function() {
                directoryExplorerModel = new DirectoryExplorerModel({path: '/home/dir/'});
                setPathSpy = spyOn(directoryExplorerModel, 'set');

                directoryBreadcrumbs = new DirectoryBreadcrumbs([], {directoryExplorer: directoryExplorerModel});
                directoryBreadcrumbView = new DirectoryBreadcrumbView({collection: directoryBreadcrumbs, directoryExplorer: directoryExplorerModel});
                directoryBreadcrumbView.render();
                directoryBreadcrumbs.fetch();
            });

            afterEach(function() {
                directoryBreadcrumbView.destroy();
            });

            it('calls directoryExplorer.set("path") when a crumb is clicked', function() {
                var homeCrumb = directoryBreadcrumbs.models[1];
                var pathStub = jasmine.createSpy();
                mockClickedCrumbObj = {model: homeCrumb};

                expect(setPathSpy).not.toHaveBeenCalled();
                directoryBreadcrumbView.onCrumbClick(mockClickedCrumbObj);
                expect(setPathSpy).toHaveBeenCalledWith('path', homeCrumb.get('path'));
            });

        });
    });
});