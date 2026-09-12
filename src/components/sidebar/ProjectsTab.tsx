import { useState } from 'react';
import { FolderOpen, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGraphStore } from '../../store/graphStore';
import { GitHubPanel } from './GitHubPanel';

export function ProjectsTab() {
  const projects = useGraphStore((state) => state.projects);
  const activeId = useGraphStore((state) => state.activeProjectId);
  const projectsLoading = useGraphStore((state) => state.projectsLoading);
  const operationId = useGraphStore((state) => state.projectOperationId);
  const projectError = useGraphStore((state) => state.projectError);
  const failedProjectId = useGraphStore((state) => state.failedProjectId);
  const initializeProjects = useGraphStore((state) => state.initializeProjects);
  const activateProject = useGraphStore((state) => state.activateProject);
  const createProject = useGraphStore((state) => state.createProject);
  const refreshProject = useGraphStore((state) => state.refreshProject);
  const unregisterProject = useGraphStore((state) => state.unregisterProject);

  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRoot, setNewRoot] = useState('');
  const [newColor, setNewColor] = useState('#8b5cf6');

  const addProject = async () => {
    if (!newName.trim() || !newRoot.trim()) return;
    try {
      await createProject({ name: newName.trim(), root: newRoot.trim(), color: newColor });
      setNewName('');
      setNewRoot('');
      setShowModal(false);
    } catch {
      // El store publica el error en la interfaz.
    }
  };

  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Proyectos</span>
        <span className="text-[9px] text-text-muted">{projects.length} registrados</span>
      </div>

      <GitHubPanel />

      <div className="flex flex-col gap-2">
        {projectsLoading && (
          <div className="flex items-center gap-2 text-xs text-text-muted p-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando registro…
          </div>
        )}
        {projects.map((project) => {
          const busy = operationId === project.id;
          const active = activeId === project.id;
          const selectable = project.graph_exists && !busy;
          return (
            <div
              key={project.id}
              onClick={() => { if (selectable) void activateProject(project.id); }}
              aria-disabled={!selectable}
              title={project.graph_exists
                ? `Cargar ${project.name}`
                : project.graph_error || 'Grafo pendiente: usa el botón de regenerar'}
              className={cn(
                'relative group rounded-xl p-3.5 border transition-all',
                active
                  ? 'border-brand/30 bg-brand/5'
                  : 'border-border hover:border-border-hover bg-bg-base',
                selectable ? 'cursor-pointer' : 'cursor-not-allowed',
                busy && 'opacity-70 cursor-wait',
                !project.graph_exists && 'opacity-75',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: project.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-text-primary truncate">{project.name}</div>
                  <div className="text-[10px] text-text-muted mt-0.5 truncate font-mono">{project.root}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-text-muted">
                    <span className={project.graph_exists ? 'text-emerald-500' : 'text-amber-500'}>
                      {project.graph_exists ? 'Grafo listo' : 'Grafo pendiente'}
                    </span>
                    {project.graph_summary?.nodes != null && <span>{project.graph_summary.nodes.toLocaleString()} nodos</span>}
                    {project.generated_at && <span>{new Date(project.generated_at).toLocaleString()}</span>}
                  </div>
                  {project.last_error && (
                    <div className="mt-2 text-[9px] leading-relaxed text-red-400 line-clamp-2">{project.last_error}</div>
                  )}
                  {!project.graph_exists && project.graph_error && !project.last_error && (
                    <div className="mt-2 text-[9px] leading-relaxed text-amber-400 line-clamp-2">{project.graph_error}</div>
                  )}
                </div>
                {active && (
                  <div className="flex items-center gap-1.5 pr-7">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] text-emerald-500 font-bold uppercase">Activo</span>
                  </div>
                )}
              </div>
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void refreshProject(project.id).catch(() => undefined);
                  }}
                  disabled={busy}
                  className="p-1 hover:bg-brand/10 rounded disabled:opacity-40"
                  title="Regenerar grafo de forma transaccional"
                >
                  {busy ? <Loader2 className="w-3 h-3 text-brand animate-spin" /> : <RefreshCw className="w-3 h-3 text-brand" />}
                </button>
                {!project.protected && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void unregisterProject(project.id).catch(() => undefined);
                    }}
                    className="p-1 hover:bg-red-500/10 rounded"
                    title="Quitar del registro (conserva sus archivos)"
                  >
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!showModal ? (
        <button
          onClick={() => setShowModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border hover:border-brand/50 text-text-muted hover:text-text-primary transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Añadir y generar proyecto
        </button>
      ) : (
        <div className="bg-bg-base border border-brand/20 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-primary">Nuevo Proyecto</span>
            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-bg-elevated rounded">
              <X className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Nombre</span>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Mi Proyecto"
              className="bg-bg-surface border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 text-text-primary"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Ruta raíz</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={newRoot}
                onChange={(event) => setNewRoot(event.target.value)}
                placeholder="C:\\ruta\\a\\mi\\proyecto"
                className="flex-1 bg-bg-surface border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 text-text-primary font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch('http://127.0.0.1:3098/api/select-folder', {
                      method: 'POST',
                    });
                    const data = await response.json();
                    if (data.path) setNewRoot(data.path);
                  } catch {
                    // El campo manual continúa disponible.
                  }
                }}
                className="p-1.5 bg-bg-surface border border-border rounded-lg hover:bg-bg-elevated transition-colors"
                title="Seleccionar carpeta"
              >
                <FolderOpen className="w-4 h-4 text-text-muted" />
              </button>
            </div>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest">Color</span>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => setNewColor(color)}
                  className={cn(
                    'w-6 h-6 rounded-full transition-transform',
                    newColor === color ? 'ring-2 ring-offset-2 ring-offset-bg-base scale-110' : 'hover:scale-110',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <button
            onClick={() => void addProject()}
            disabled={!newName.trim() || !newRoot.trim() || operationId === 'create'}
            className="mt-1 w-full py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {operationId === 'create' && <Loader2 className="w-4 h-4 animate-spin" />}
            {operationId === 'create' ? 'Generando grafo…' : 'Crear proyecto y grafo'}
          </button>
        </div>
      )}

      {projectError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[10px] leading-relaxed text-red-400">
          <div>{projectError}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {failedProjectId && projects.some((project) => project.id === failedProjectId && project.graph_exists) && (
              <button
                type="button"
                onClick={() => void activateProject(failedProjectId)}
                className="rounded-md border border-red-400/30 px-2 py-1 font-semibold text-red-300 hover:bg-red-500/10"
              >
                Reintentar carga
              </button>
            )}
            <button
              type="button"
              onClick={() => void initializeProjects()}
              disabled={projectsLoading}
              className="rounded-md border border-border px-2 py-1 font-semibold text-text-muted hover:bg-bg-elevated disabled:opacity-40"
            >
              Recargar registro
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 bg-bg-base border border-border rounded-xl p-3">
        <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">MCP multiproyecto</div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] text-emerald-500 font-semibold">http://127.0.0.1:3098</span>
        </div>
        <div className="text-[10px] text-text-muted leading-relaxed">
          La selección cambia el grafo, la raíz de lectura y el índice de impacto. Las consultas MCP aceptan <code className="text-brand">projectId</code>.
        </div>
      </div>
    </div>
  );
}
