import { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { AlertCircle, Search, FolderTree, FileCode, Zap, Image, List, Route, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { cn } from './lib/utils';
import { useGraphStore } from './store/graphStore';
import { Sidebar } from './components/sidebar/Sidebar';
import { VisualGraphEngine } from './components/VisualGraphEngine';
import { NodeDetail } from './components/detail/NodeDetail';
import { openInOS } from './lib/fileOpener';

export default function App() {
  const loading = useGraphStore((s) => s.loading);
  const error = useGraphStore((s) => s.error);
  const initializeProjects = useGraphStore((s) => s.initializeProjects);
  const activateProject = useGraphStore((s) => s.activateProject);
  const failedProjectId = useGraphStore((s) => s.failedProjectId);
  const query = useGraphStore((s) => s.query);
  const setQuery = useGraphStore((s) => s.setQuery);
  const viewMode = useGraphStore((s) => s.viewMode);
  const setViewMode = useGraphStore((s) => s.setViewMode);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const graphData = useGraphStore((s) => s.graphData);
  const searchFn = useGraphStore((s) => s.search);
  const setSidebarTab = useGraphStore((s) => s.setSidebarTab);

  useEffect(() => {
    void initializeProjects();
  }, [initializeProjects]);

  const searchResults = query ? searchFn(query) : [];
  const retryGraph = () => {
    if (failedProjectId) {
      void activateProject(failedProjectId);
    } else {
      void initializeProjects();
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary selection:bg-brand/20">
      {/* Sidebar with Tabs */}
      <AnimatePresence>
        <Sidebar />
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-bg-surface/80 backdrop-blur-md flex items-center px-4 gap-4 sticky top-0 z-20">
          {/* View Toggles */}
          <div className="flex bg-bg-base border border-border p-1 rounded-lg">
            <button
              onClick={() => setViewMode('visual')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5',
                viewMode === 'visual' ? 'bg-bg-elevated text-brand shadow-sm border border-border/50' : 'text-text-muted hover:text-text-primary'
              )}
            >
              <Route className="w-3.5 h-3.5" />
              Nodos
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1.5',
                viewMode === 'list' ? 'bg-bg-elevated text-brand shadow-sm border border-border/50' : 'text-text-muted hover:text-text-primary'
              )}
            >
              <List className="w-3.5 h-3.5" />
              Lista
            </button>
          </div>

          {/* Search */}
          <div className="flex-1 max-w-2xl relative mx-auto group">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-brand transition-colors" />
            <input
              type="text"
              placeholder="Fuzzy Search: 'plano 3d', 'icons', 'main.rb'..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-bg-base border border-border hover:border-border-hover rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all placeholder:text-text-muted/60 shadow-sm"
            />
            {query && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-bg-surface border border-border rounded-xl shadow-2xl overflow-hidden max-h-[60vh] flex flex-col z-50">
                <div className="overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <div className="p-6 text-center text-text-muted text-sm">
                      <Search className="w-6 h-6 mb-2 opacity-20 mx-auto" />
                      No se encontraron resultados
                    </div>
                  ) : (
                    searchResults.map((node: any) => {
                      const relPath = (node.relative_path || node.id || '').replace('file:', '').replace('folder:', '');
                      return (
                        <div
                          key={node.id}
                          className="w-full text-left px-4 py-3 hover:bg-bg-elevated border-b border-border/40 last:border-0 flex items-start gap-3 transition-colors cursor-pointer"
                          onClick={() => { selectNode(node.id); setQuery(''); }}
                        >
                          <div className="mt-0.5 p-1.5 bg-bg-base rounded-md border border-border">
                            {node.type === 'file' ? <FileCode className="w-3.5 h-3.5 text-brand" /> :
                             node.type === 'folder' ? <FolderTree className="w-3.5 h-3.5 text-amber-500" /> :
                             node.type === 'asset' ? <Image className="w-3.5 h-3.5 text-emerald-500" /> :
                             <Zap className="w-3.5 h-3.5 text-amber-500" />}
                          </div>
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-medium text-text-primary truncate">{relPath}</span>
                            {node.classification?.module_name && (
                              <span className="text-[11px] text-text-muted truncate mt-0.5 uppercase tracking-wider font-semibold">
                                MOD: {node.classification.module_name}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); openInOS(relPath); }}
                            className="p-1.5 hover:bg-bg-base rounded-md transition-colors opacity-0 group-hover:opacity-100"
                            title="Abrir archivo"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Main Area */}
        <main className="flex-1 overflow-auto bg-bg-base relative">
          {error && graphData && (
            <div className="absolute left-1/2 top-3 z-40 flex max-w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-red-500/30 bg-bg-surface/95 px-4 py-2 text-xs shadow-xl backdrop-blur">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span className="min-w-0 flex-1 truncate text-text-muted">{error}</span>
              <button onClick={retryGraph} className="font-semibold text-brand hover:underline">Reintentar</button>
              <button onClick={() => setSidebarTab('projects')} className="font-semibold text-text-primary hover:underline">Cambiar</button>
            </div>
          )}

          {!graphData ? (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              {loading ? (
                <div className="flex flex-col items-center gap-3 text-sm text-text-muted">
                  <Loader2 className="h-8 w-8 animate-spin text-brand" />
                  Cargando el grafo seleccionado…
                </div>
              ) : (
                <div className="w-full max-w-xl rounded-2xl border border-border bg-bg-surface p-6 text-center shadow-xl">
                  <AlertCircle className="mx-auto h-8 w-8 text-amber-400" />
                  <h1 className="mt-4 text-lg font-bold">No hay un grafo cargado</h1>
                  <p className="mt-2 text-sm text-text-muted">
                    {error || 'Selecciona un proyecto con grafo listo o regenera uno pendiente.'}
                  </p>
                  <p className="mt-2 text-xs text-text-muted">La API debe estar disponible únicamente en 127.0.0.1:3098.</p>
                  <div className="mt-5 flex justify-center gap-3">
                    <button
                      onClick={retryGraph}
                      className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand/90"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Reintentar
                    </button>
                    <button
                      onClick={() => setSidebarTab('projects')}
                      className="flex items-center gap-2 rounded-lg bg-[#24292f] px-4 py-2 text-xs font-semibold text-white hover:bg-[#24292f]/90 transition-colors shadow-sm"
                    >
                      <svg height="16" aria-hidden="true" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" className="fill-current">
                        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                      </svg>
                      Abrir conexión GitHub
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : viewMode === 'visual' ? (
            <div className="absolute inset-0 p-4">
              <VisualGraphEngine graphData={graphData} focusNodeId={selectedNodeId} />
            </div>
          ) : (
            <div className="p-4 md:p-8 relative h-full">
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, var(--color-border) 1px, transparent 0)', backgroundSize: '32px 32px', opacity: 0.3 }} />
              {selectedNodeId ? (
                <NodeDetail />
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-muted relative z-10">
                  <div className="bg-bg-surface/50 border border-border p-8 rounded-3xl flex flex-col items-center backdrop-blur-sm">
                    <div className="w-16 h-16 bg-bg-elevated border border-border rounded-2xl flex items-center justify-center mb-6 shadow-inner">
                      <Search className="w-8 h-8 text-text-secondary opacity-50" />
                    </div>
                    <p className="text-xl font-semibold text-text-primary tracking-tight">ThingForce™ Graph Studio</p>
                    <p className="text-sm text-text-muted mt-3 max-w-[280px] text-center leading-relaxed">
                      Busca archivos, íconos o funciones en la barra superior para explorar las conexiones del código.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading && graphData && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg-base/20 backdrop-blur-[1px]">
              <Loader2 className="h-7 w-7 animate-spin text-brand" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
