import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname, relative, resolve, sep } from 'path';
import { spawn } from 'child_process';

const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 15 * 1000;
const DEFAULT_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const IGNORED_GRAPH_DIRECTORY_NAMES = new Set([
  '.git', '.idea', '.vscode', '.venv', 'venv', 'env', 'node_modules',
  'dist', 'build', 'coverage', 'temp', 'backups', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.runtime', '.staging', 'output_videos',
]);

export function isIgnoredProjectPath(relativePath) {
  if (typeof relativePath !== 'string') return false;
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  return normalized
    .split('/')
    .some((part) => IGNORED_GRAPH_DIRECTORY_NAMES.has(part))
    || normalized.includes('.bak');
}

function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..');
}

function runProcess(command, args, { cwd, timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} excedió ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} terminó con código ${code}: ${stderr || stdout}`));
    });
  });
}

export function acquireGenerationLock(publicRoot, projectId) {
  const locksRoot = resolve(publicRoot, '.locks');
  mkdirSync(locksRoot, { recursive: true });
  const lockPath = resolve(locksRoot, `${projectId}.lock`);
  if (!isInside(locksRoot, lockPath)) throw new Error('Lock de generación inseguro');
  const ownerToken = randomUUID();

  const create = () => {
    const descriptor = openSync(lockPath, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify({
        project_id: projectId,
        pid: process.pid,
        owner_token: ownerToken,
        acquired_at: new Date().toISOString(),
      })}\n`, 'utf-8');
    } finally {
      closeSync(descriptor);
    }
  };

  try {
    create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < LOCK_STALE_MS) {
      throw new Error(`Ya existe una generación activa para ${projectId}`);
    }
    const stalePath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
    renameSync(lockPath, stalePath);
    rmSync(stalePath, { force: true });
    create();
  }

  const stillOwned = () => {
    try {
      const payload = JSON.parse(readFileSync(lockPath, 'utf-8'));
      return payload.owner_token === ownerToken;
    } catch {
      return false;
    }
  };
  const heartbeat = setInterval(() => {
    if (!stillOwned()) return;
    try {
      const now = new Date();
      utimesSync(lockPath, now, now);
    } catch {
      // A release/reclaim can race the heartbeat; ownership verification on
      // release prevents deleting a successor's lock.
    }
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  return () => {
    clearInterval(heartbeat);
    if (stillOwned()) rmSync(lockPath, { force: true });
  };
}

export function validateGraph(graphPath, projectRoot) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
  if (resolve(graph.root || '').toLowerCase() !== resolve(projectRoot).toLowerCase()) {
    throw new Error(`La raíz del grafo no coincide: ${graph.root}`);
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0 || !Array.isArray(graph.edges)) {
    throw new Error('El grafo generado no contiene nodes/edges válidos');
  }
  const definedBridgeIds = new Set(
    graph.edges
      .filter((edge) => edge.type === 'defines_bridge_callback')
      .map((edge) => edge.to),
  );
  const invalidBridgeIds = new Set(
    graph.nodes
      .filter((node) => node.type === 'bridge_callback' && !definedBridgeIds.has(node.id))
      .map((node) => node.id),
  );
  if (invalidBridgeIds.size) {
    graph.nodes = graph.nodes.filter((node) => !invalidBridgeIds.has(node.id));
    graph.edges = graph.edges.filter(
      (edge) => !invalidBridgeIds.has(edge.from) && !invalidBridgeIds.has(edge.to),
    );
  }

  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node?.id || ids.has(node.id)) throw new Error(`Nodo inválido o duplicado: ${node?.id}`);
    ids.add(node.id);
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`Arista huérfana: ${edge.from} -> ${edge.to}`);
    }
  }
  graph.summary ||= {};
  graph.summary.base_scan = {
    files_scanned: graph.summary.files_scanned || 0,
    files_changed: graph.summary.files_changed || 0,
    files_reused_from_cache: graph.summary.files_reused_from_cache || 0,
    layers: graph.summary.layers || {},
    languages: graph.summary.languages || {},
  };
  graph.summary.nodes_total = graph.nodes.length;
  graph.summary.edges_total = graph.edges.length;
  graph.summary.files_scanned = new Set(
    graph.nodes
      .filter((node) => ['file', 'asset'].includes(node.type) && node.relative_path)
      .map((node) => node.relative_path),
  ).size;
  // El escáner incremental base conserva estas listas como telemetría. Deben
  // obedecer el mismo límite del grafo final para no presentar salidas,
  // respaldos o cachés como cambios de código indexados.
  for (const field of ['changed_files', 'reused_files']) {
    if (Array.isArray(graph.summary[field])) {
      graph.summary[field] = graph.summary[field].filter(
        (relativePath) => !isIgnoredProjectPath(relativePath),
      );
    }
  }
  graph.summary.files_changed = Array.isArray(graph.summary.changed_files)
    ? graph.summary.changed_files.length
    : 0;
  graph.summary.files_reused_from_cache = Array.isArray(graph.summary.reused_files)
    ? graph.summary.reused_files.length
    : 0;
  const finalFiles = graph.nodes.filter((node) => node.type === 'file');
  const countClassification = (field) => finalFiles.reduce((counts, node) => {
    const value = node.classification?.[field];
    if (value) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
  graph.summary.layers = countClassification('layer');
  graph.summary.languages = countClassification('language');
  graph.summary.false_bridge_nodes_evicted = invalidBridgeIds.size;
  graph.summary.bridges_detected = graph.nodes
    .filter((node) => node.type === 'bridge_callback')
    .map((node) => node.name)
    .sort();
  return graph;
}

function writeFinalReport(reportPath, project, graph, generationId) {
  const summary = graph.summary || {};
  const lines = [
    `# ThingForce Graph — reporte final enriquecido`,
    '',
    `- Proyecto: ${project.name} (\`${project.id}\`)`,
    `- Raíz: \`${project.root}\``,
    `- Generación: \`${generationId}\``,
    `- Nodos finales: ${graph.nodes.length}`,
    `- Aristas finales: ${graph.edges.length}`,
    `- Archivos/activos indexados: ${summary.files_scanned || 0}`,
    `- Funciones Python AST: ${summary.python_enricher?.functions || 0}`,
    `- Bridges falsos eliminados: ${summary.false_bridge_nodes_evicted || 0}`,
    '',
    '## Alcance',
    '',
    'El reporte describe el grafo después de todos los enriquecedores y validaciones.',
    'Se excluyen del índice final Backups, caches, `.runtime` y `Output_Videos`.',
    'El grafo es un índice derivado; el código vivo continúa siendo la autoridad.',
    '',
  ];
  writeFileSync(reportPath, lines.join('\n'), 'utf-8');
}

function atomicPublish(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.new-${process.pid}-${Date.now()}`;
  const rollback = `${target}.rollback-${process.pid}-${Date.now()}`;
  copyFileSync(source, temp);
  let hadPrevious = false;
  try {
    if (existsSync(target)) {
      renameSync(target, rollback);
      hadPrevious = true;
    }
    renameSync(temp, target);
    if (hadPrevious) rmSync(rollback, { force: true });
  } catch (error) {
    if (existsSync(temp)) rmSync(temp, { force: true });
    if (hadPrevious && !existsSync(target) && existsSync(rollback)) renameSync(rollback, target);
    throw error;
  }
}

export async function generateProjectGraph({
  project,
  graphPath,
  studioRoot,
  publicRoot,
  force = true,
}) {
  if (!project || !existsSync(project.root) || !statSync(project.root).isDirectory()) {
    throw new Error(`Raíz de proyecto inválida: ${project?.root}`);
  }
  const safePublicRoot = resolve(publicRoot);
  const targetGraphPath = resolve(graphPath);
  if (!isInside(safePublicRoot, targetGraphPath)) throw new Error('Destino fuera de public/');

  const stagingRoot = resolve(safePublicRoot, '.staging');
  const stagingDir = resolve(stagingRoot, `${project.id}-${Date.now()}-${process.pid}`);
  if (!isInside(stagingRoot, stagingDir)) throw new Error('Staging inseguro');
  const releaseLock = acquireGenerationLock(safePublicRoot, project.id);

  const stageGraph = resolve(stagingDir, 'graph.json');
  const logs = [];

  try {
    mkdirSync(stagingDir, { recursive: true });
    if (!force) {
      const previousCache = resolve(dirname(targetGraphPath), 'cache.json');
      if (existsSync(previousCache)) copyFileSync(previousCache, resolve(stagingDir, 'cache.json'));
    }
    logs.push(await runProcess(
      process.execPath,
      [resolve(studioRoot, 'scripts', 'generate-base-graph.mjs'), project.root, stageGraph],
      { cwd: studioRoot },
    ));
    if (!existsSync(stageGraph)) throw new Error('El generador no produjo graph.json');

    logs.push(await runProcess(
      process.execPath,
      [resolve(studioRoot, 'scripts', 'enrichGraph.mjs'), project.root, stageGraph],
      { cwd: studioRoot },
    ));
    logs.push(await runProcess(
      process.execPath,
      [resolve(studioRoot, 'scripts', 'deepEnrich.mjs'), project.root, stageGraph],
      { cwd: studioRoot },
    ));
    try {
      logs.push(await runProcess(
        process.env.PYTHON || 'python',
        [resolve(studioRoot, 'scripts', 'enrich_python_graph.py'), project.root, stageGraph],
        { cwd: studioRoot },
      ));
    } catch (error) {
      logs.push({ stdout: '', stderr: `Python AST opcional omitido: ${error.message}` });
    }

    const graph = validateGraph(stageGraph, project.root);
    const generationId = `${project.id}-${Date.now()}-${process.pid}`;
    graph.summary.generation_id = generationId;
    graph.summary.finalized_at = new Date().toISOString();
    writeFileSync(stageGraph, JSON.stringify(graph), 'utf-8');
    writeFinalReport(resolve(stagingDir, 'GRAPH_REPORT.md'), project, graph, generationId);

    // Publish auxiliaries first and graph.json last. The graph is the commit
    // marker: readers either observe the prior complete graph or the new one.
    for (const auxiliary of ['cache.json', 'GRAPH_REPORT.md']) {
      const source = resolve(stagingDir, auxiliary);
      if (existsSync(source)) atomicPublish(source, resolve(dirname(targetGraphPath), auxiliary));
    }
    atomicPublish(stageGraph, targetGraphPath);
    return {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      files_scanned: graph.summary?.files_scanned || 0,
      graph_file: project.graph_file,
      log_tail: logs
        .flatMap((entry) => `${entry.stdout}\n${entry.stderr}`.split(/\r?\n/))
        .filter(Boolean)
        .slice(-20),
    };
  } finally {
    if (existsSync(stagingDir) && isInside(stagingRoot, stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    releaseLock();
  }
}
