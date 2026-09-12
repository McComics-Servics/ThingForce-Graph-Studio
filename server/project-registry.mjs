import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';

export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_LOCK_STALE_MS = 2 * 60 * 1000;
const REGISTRY_LOCK_WAIT_MS = 10 * 1000;
const REGISTRY_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));

export function slugifyProjectId(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function graphDestinationKey(publicRoot, graphFile) {
  return resolve(publicRoot, ...graphFile.split('/')).toLowerCase();
}

function assertDirectory(path, label) {
  if (!isAbsolute(path)) throw new Error(`${label} debe ser una ruta absoluta`);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} no existe o no es una carpeta: ${path}`);
  }
}

function isExistingDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export class ProjectRegistry {
  constructor({ studioRoot, registryPath } = {}) {
    this.studioRoot = resolve(studioRoot || process.cwd());
    this.publicRoot = resolve(this.studioRoot, 'public');
    this.registryPath = resolve(
      registryPath || resolve(this.studioRoot, 'config', 'projects.json'),
    );
    if (!existsSync(this.registryPath)) {
      mkdirSync(dirname(this.registryPath), { recursive: true });
      writeFileSync(this.registryPath, `${JSON.stringify({
        schema_version: PROJECT_REGISTRY_SCHEMA_VERSION,
        default_project_id: null,
        projects: [],
      }, null, 2)}\n`, 'utf-8');
    }
    this.payload = this.#read();
    this.registryStamp = this.#stamp();
    this.graphIdentityCache = new Map();
  }

  #stamp() {
    const stat = statSync(this.registryPath);
    return `${stat.size}:${stat.mtimeMs}`;
  }

  #read() {
    const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8'));
    if (parsed.schema_version !== PROJECT_REGISTRY_SCHEMA_VERSION) {
      throw new Error(`Versión de registro no soportada: ${parsed.schema_version}`);
    }
    if (!Array.isArray(parsed.projects)) {
      throw new Error('El registro debe declarar una lista de proyectos');
    }
    const ids = new Set();
    const graphFiles = new Set();
    const projects = parsed.projects.map((project) => {
      const normalized = this.#normalize(project, { requireRoot: false });
      if (ids.has(normalized.id)) throw new Error(`Proyecto duplicado: ${normalized.id}`);
      const graphKey = graphDestinationKey(this.publicRoot, normalized.graph_file);
      if (graphFiles.has(graphKey)) {
        throw new Error(`graph_file duplicado: ${normalized.graph_file}`);
      }
      ids.add(normalized.id);
      graphFiles.add(graphKey);
      return normalized;
    });
    const defaultId = parsed.default_project_id || projects[0]?.id || null;
    if (defaultId && !ids.has(defaultId)) throw new Error(`Proyecto predeterminado inexistente: ${defaultId}`);
    return {
      schema_version: PROJECT_REGISTRY_SCHEMA_VERSION,
      default_project_id: defaultId,
      projects,
    };
  }

  #normalize(project, { requireRoot = true } = {}) {
    const id = slugifyProjectId(project.id || project.name);
    if (!id) throw new Error('El proyecto necesita un identificador válido');
    const name = String(project.name || '').trim();
    if (!name) throw new Error(`El proyecto ${id} necesita nombre`);
    const rootValue = String(project.root || '').trim();
    if (!rootValue) throw new Error(`El proyecto ${id} necesita una raíz explícita`);
    if (!isAbsolute(rootValue)) throw new Error(`Raíz de ${id} debe ser absoluta`);
    const root = resolve(rootValue);
    if (requireRoot) assertDirectory(root, `Raíz de ${id}`);
    const graphFile = String(project.graph_file || `projects/${id}/graph.json`)
      .replace(/\\/g, '/');
    if (!graphFile || isAbsolute(graphFile) || graphFile.split('/').includes('..')) {
      throw new Error(`graph_file inseguro para ${id}: ${graphFile}`);
    }
    if (!graphFile.toLowerCase().endsWith('.json')) {
      throw new Error(`graph_file debe terminar en .json para ${id}`);
    }
    const graphPath = resolve(this.publicRoot, ...graphFile.split('/'));
    if (!isInside(this.publicRoot, graphPath)) {
      throw new Error(`graph_file sale de public/: ${graphFile}`);
    }
    return {
      id,
      name,
      root,
      graph_file: graphFile,
      color: /^#[0-9a-f]{6}$/i.test(project.color || '') ? project.color : '#8b5cf6',
      protected: Boolean(project.protected),
      generator: project.generator || 'mccomics_incremental',
      generated_at: project.generated_at || null,
      last_error: project.last_error || null,
      graph_summary: project.graph_summary || null,
    };
  }

  #persist() {
    mkdirSync(dirname(this.registryPath), { recursive: true });
    const tempPath = `${this.registryPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tempPath, `${JSON.stringify(this.payload, null, 2)}\n`, 'utf-8');
    renameSync(tempPath, this.registryPath);
    this.registryStamp = this.#stamp();
  }

  #withWriteLock(mutator) {
    const lockPath = `${this.registryPath}.lock`;
    const createLock = () => {
      const descriptor = openSync(lockPath, 'wx');
      try {
        writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          acquired_at: new Date().toISOString(),
        })}\n`, 'utf-8');
      } finally {
        closeSync(descriptor);
      }
    };

    const deadline = Date.now() + REGISTRY_LOCK_WAIT_MS;
    while (true) {
      try {
        createLock();
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const ageMs = Date.now() - statSync(lockPath).mtimeMs;
          if (ageMs >= REGISTRY_LOCK_STALE_MS) {
            const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
            renameSync(lockPath, stalePath);
            rmSync(stalePath, { force: true });
            continue;
          }
        } catch (inspectionError) {
          // Another writer may release/reclaim the lock between EEXIST and
          // stat/rename. Retry that benign race; propagate unrelated errors.
          if (!['ENOENT', 'EEXIST'].includes(inspectionError?.code)) throw inspectionError;
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error('El registro multiproyecto continúa ocupado tras 10 segundos');
        }
        Atomics.wait(REGISTRY_WAIT_ARRAY, 0, 0, 25);
      }
    }

    try {
      // Merge-by-reload: every mutation starts from the latest atomic file,
      // preventing two project generations from losing each other's summary.
      this.payload = this.#read();
      const result = mutator();
      this.#persist();
      return result;
    } finally {
      rmSync(lockPath, { force: true });
    }
  }

  reloadIfChanged({ force = false } = {}) {
    const stamp = this.#stamp();
    if (force || stamp !== this.registryStamp) {
      this.payload = this.#read();
      this.registryStamp = stamp;
      return true;
    }
    return false;
  }

  list() {
    this.reloadIfChanged();
    return this.payload.projects.map((project) => this.describe(project));
  }

  get defaultProjectId() {
    this.reloadIfChanged();
    return this.payload.default_project_id;
  }

  get(id) {
    this.reloadIfChanged();
    const projectId = id || this.defaultProjectId;
    return this.payload.projects.find((project) => project.id === projectId) || null;
  }

  describe(project) {
    const status = this.graphStatus(project);
    return {
      ...project,
      root_exists: isExistingDirectory(project.root),
      // Backward-compatible readiness flag: an existing graph for another
      // root is never considered usable.
      graph_exists: status.ready,
      graph_file_exists: status.exists,
      graph_error: status.error,
      graph_url: `/api/projects/${encodeURIComponent(project.id)}/graph`,
    };
  }

  graphStatus(projectOrId) {
    const project = typeof projectOrId === 'string' ? this.get(projectOrId) : projectOrId;
    if (!project) return { exists: false, ready: false, error: 'Proyecto no encontrado' };
    if (!isExistingDirectory(project.root)) {
      return { exists: false, ready: false, error: `La raíz no está disponible: ${project.root}` };
    }
    const graphPath = this.graphPath(project);
    if (!existsSync(graphPath)) {
      return { exists: false, ready: false, error: 'Grafo pendiente' };
    }
    let stat;
    try {
      stat = statSync(graphPath);
    } catch {
      return { exists: false, ready: false, error: 'Grafo en publicación; reintente' };
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cacheKey = `${graphPath}\u0000${resolve(project.root).toLowerCase()}`;
    const cached = this.graphIdentityCache.get(cacheKey);
    if (cached?.stamp === stamp) return cached.status;

    let status;
    try {
      const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
      const rootMatches = typeof graph.root === 'string'
        && resolve(graph.root).toLowerCase() === resolve(project.root).toLowerCase();
      const shapeMatches = Array.isArray(graph.nodes) && Array.isArray(graph.edges);
      status = rootMatches && shapeMatches
        ? { exists: true, ready: true, error: null }
        : {
            exists: true,
            ready: false,
            error: rootMatches
              ? 'El archivo no contiene nodes/edges válidos'
              : 'La raíz declarada por el grafo no coincide con el proyecto',
          };
    } catch (error) {
      status = { exists: true, ready: false, error: `Grafo ilegible: ${error.message}` };
    }
    this.graphIdentityCache.set(cacheKey, { stamp, status });
    return status;
  }

  assertGraphReady(projectOrId) {
    const project = typeof projectOrId === 'string' ? this.get(projectOrId) : projectOrId;
    const status = this.graphStatus(project);
    if (!status.ready) throw new Error(status.error || 'Grafo no disponible');
    return this.graphPath(project);
  }

  graphPath(projectOrId) {
    const project = typeof projectOrId === 'string' ? this.get(projectOrId) : projectOrId;
    if (!project) throw new Error('Proyecto no encontrado');
    const candidate = resolve(this.publicRoot, ...project.graph_file.split('/'));
    if (!isInside(this.publicRoot, candidate)) throw new Error('Ruta de grafo fuera de public/');
    return candidate;
  }

  register(input) {
    const id = slugifyProjectId(input.id || input.name);
    return this.#withWriteLock(() => {
      if (this.payload.projects.some((project) => project.id === id)) {
        throw new Error(`Ya existe el proyecto ${id}`);
      }
      const project = this.#normalize({ ...input, id }, { requireRoot: true });
      if (this.payload.projects.some(
        (item) => graphDestinationKey(this.publicRoot, item.graph_file)
          === graphDestinationKey(this.publicRoot, project.graph_file),
      )) {
        throw new Error(`graph_file duplicado: ${project.graph_file}`);
      }
      this.payload.projects.push(project);
      if (!this.payload.default_project_id) this.payload.default_project_id = project.id;
      return project;
    });
  }

  markGenerated(id, summary) {
    return this.#withWriteLock(() => {
      const project = this.payload.projects.find((item) => item.id === id);
      if (!project) throw new Error(`Proyecto no encontrado: ${id}`);
      project.generated_at = new Date().toISOString();
      project.last_error = null;
      project.graph_summary = summary || null;
      return project;
    });
  }

  markError(id, error) {
    return this.#withWriteLock(() => {
      const project = this.payload.projects.find((item) => item.id === id);
      if (!project) return null;
      project.last_error = String(error?.message || error);
      return project;
    });
  }

  unregister(id) {
    return this.#withWriteLock(() => {
      const project = this.payload.projects.find((item) => item.id === id);
      if (!project) throw new Error(`Proyecto no encontrado: ${id}`);
      if (project.protected) throw new Error(`El proyecto ${id} está protegido`);
      this.payload.projects = this.payload.projects.filter((item) => item.id !== id);
      if (this.payload.default_project_id === id) {
        this.payload.default_project_id = this.payload.projects[0]?.id || null;
      }
      return project;
    });
  }
}
