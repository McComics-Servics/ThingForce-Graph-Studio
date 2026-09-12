import { create } from 'zustand';
import { buildGraphIndex, type GraphIndex } from '../lib/graphIndex';
import { setupFuzzySearch } from '../lib/search';
import type Fuse from 'fuse.js';

const GRAPH_API = import.meta.env.VITE_GRAPH_API || 'http://127.0.0.1:3098';
const ACTIVE_PROJECT_KEY = 'thingforce_active_project';

let graphRequestToken = 0;
let graphAbortController: AbortController | null = null;

export interface GraphProject {
  id: string;
  name: string;
  root: string;
  graph_file: string;
  graph_url: string;
  graph_exists: boolean;
  graph_file_exists: boolean;
  graph_error: string | null;
  root_exists: boolean;
  color: string;
  protected: boolean;
  generated_at: string | null;
  last_error: string | null;
  graph_summary: {
    nodes?: number;
    edges?: number;
    files_scanned?: number;
  } | null;
}

interface GraphState {
  graphData: any | null;
  loading: boolean;
  error: string | null;
  index: GraphIndex | null;
  fuse: Fuse<any> | null;
  selectedNodeId: string | null;
  query: string;
  viewMode: 'list' | 'visual';
  sidebarTab: 'projects' | 'metrics' | 'explorer' | 'trace';

  projects: GraphProject[];
  activeProjectId: string | null;
  failedProjectId: string | null;
  projectsLoading: boolean;
  projectOperationId: string | null;
  projectError: string | null;

  loadGraph: (url: string) => Promise<boolean>;
  initializeProjects: () => Promise<void>;
  activateProject: (id: string) => Promise<boolean>;
  createProject: (input: { name: string; root: string; color: string }) => Promise<void>;
  refreshProject: (id: string) => Promise<void>;
  unregisterProject: (id: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  setQuery: (q: string) => void;
  setViewMode: (mode: 'list' | 'visual') => void;
  setSidebarTab: (tab: 'projects' | 'metrics' | 'explorer' | 'trace') => void;
  search: (q: string) => any[];
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function fetchProjects(): Promise<{ projects: GraphProject[]; default_project_id: string }> {
  return readJson(await fetch(`${GRAPH_API}/api/projects`, { cache: 'no-store' }));
}

function readyProjectId(
  projects: GraphProject[],
  preferredId: string | null,
  defaultId: string | null,
): string | null {
  const ready = (id: string | null) => projects.some((project) => project.id === id && project.graph_exists);
  if (ready(preferredId)) return preferredId;
  if (ready(defaultId)) return defaultId;
  return projects.find((project) => project.graph_exists)?.id ?? null;
}

export const useGraphStore = create<GraphState>((set, get) => {
  const requestGraph = async (
    url: string,
    projectId: string | null,
  ): Promise<boolean> => {
    const token = ++graphRequestToken;
    graphAbortController?.abort();
    const controller = new AbortController();
    graphAbortController = controller;

    set({
      loading: true,
      error: null,
      projectError: projectId ? null : get().projectError,
      failedProjectId: projectId ? null : get().failedProjectId,
      selectedNodeId: null,
      query: '',
    });

    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      const data = await readJson(response);
      const index = buildGraphIndex(data);
      const fuse = setupFuzzySearch(data.nodes || []);

      if (token !== graphRequestToken || controller.signal.aborted) return false;

      if (data.root) localStorage.setItem('thingforce_graph_root', data.root);
      if (projectId) localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);

      set({
        graphData: data,
        index,
        fuse,
        loading: false,
        error: null,
        activeProjectId: projectId ?? get().activeProjectId,
        failedProjectId: null,
        projectError: null,
      });
      return true;
    } catch (error) {
      if (token !== graphRequestToken || controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return false;
      }

      const message = error instanceof Error ? error.message : String(error);
      set({
        error: message,
        loading: false,
        failedProjectId: projectId,
        projectError: projectId ? `No se pudo cargar ${projectId}: ${message}` : get().projectError,
        sidebarTab: projectId ? 'projects' : get().sidebarTab,
      });
      return false;
    } finally {
      if (token === graphRequestToken) graphAbortController = null;
    }
  };

  return {
    graphData: null,
    loading: true,
    error: null,
    index: null,
    fuse: null,
    selectedNodeId: null,
    query: '',
    viewMode: 'visual',
    sidebarTab: 'metrics',
    projects: [],
    activeProjectId: null,
    failedProjectId: null,
    projectsLoading: true,
    projectOperationId: null,
    projectError: null,

    loadGraph: async (url: string) => requestGraph(url, null),

    initializeProjects: async () => {
      set({ projectsLoading: true, projectError: null });
      try {
        const payload = await fetchProjects();
        const saved = localStorage.getItem(ACTIVE_PROJECT_KEY);
        const targetId = readyProjectId(payload.projects, saved, payload.default_project_id);
        set({ projects: payload.projects, projectsLoading: false, error: null });

        if (targetId) {
          await get().activateProject(targetId);
          return;
        }

        graphAbortController?.abort();
        graphRequestToken += 1;
        set({
          graphData: null,
          index: null,
          fuse: null,
          activeProjectId: null,
          loading: false,
          sidebarTab: 'projects',
          projectError: 'No hay grafos listos. Regenera un proyecto pendiente desde su botón ↻.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({
          projectsLoading: false,
          projectError: message,
          error: message,
          loading: false,
          sidebarTab: 'projects',
        });
      }
    },

    activateProject: async (id: string) => {
      const project = get().projects.find((item) => item.id === id);
      if (!project) {
        set({ projectError: `Proyecto no registrado: ${id}`, failedProjectId: id, sidebarTab: 'projects' });
        return false;
      }
      if (!project.graph_exists) {
        set({
          projectError: `El grafo de ${project.name} está pendiente. Regénéralo antes de seleccionarlo.`,
          failedProjectId: id,
          sidebarTab: 'projects',
        });
        return false;
      }

      return requestGraph(`${GRAPH_API}${project.graph_url}?v=${Date.now()}`, id);
    },

    createProject: async (input) => {
      set({ projectOperationId: 'create', projectError: null });
      try {
        const created = await readJson(await fetch(`${GRAPH_API}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }));
        const payload = await fetchProjects();
        set({ projects: payload.projects, projectOperationId: null });
        await get().activateProject(created.project.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ projectOperationId: null, projectError: message, sidebarTab: 'projects' });
        throw error;
      }
    },

    refreshProject: async (id: string) => {
      set({ projectOperationId: id, projectError: null });
      try {
        await readJson(await fetch(`${GRAPH_API}/api/projects/${encodeURIComponent(id)}/refresh`, {
          method: 'POST',
        }));
        const payload = await fetchProjects();
        set({ projects: payload.projects, projectOperationId: null });
        if (get().activeProjectId === id || get().failedProjectId === id) {
          await get().activateProject(id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ projectOperationId: null, projectError: message, failedProjectId: id, sidebarTab: 'projects' });
        throw error;
      }
    },

    unregisterProject: async (id: string) => {
      set({ projectOperationId: id, projectError: null });
      try {
        await readJson(await fetch(`${GRAPH_API}/api/projects/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }));
        const payload = await fetchProjects();
        const removedActiveProject = get().activeProjectId === id;
        const targetId = removedActiveProject
          ? readyProjectId(payload.projects, null, payload.default_project_id)
          : get().activeProjectId;

        set({
          projects: payload.projects,
          projectOperationId: null,
          failedProjectId: get().failedProjectId === id ? null : get().failedProjectId,
          ...(removedActiveProject
            ? { activeProjectId: null, graphData: null, index: null, fuse: null, selectedNodeId: null }
            : {}),
        });
        if (targetId) await get().activateProject(targetId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ projectOperationId: null, projectError: message, sidebarTab: 'projects' });
        throw error;
      }
    },

    selectNode: (id) => set({ selectedNodeId: id }),
    setQuery: (q) => set({ query: q }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),

    search: (q: string) => {
      const { fuse } = get();
      if (!fuse || !q) return [];
      return fuse.search(q).slice(0, 50).map((result) => result.item);
    },
  };
});
