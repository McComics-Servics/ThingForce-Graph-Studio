import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ContentLengthDecoder,
  encodeContentLengthMessage,
} from '../server/content-length-framing.mjs';
import {
  isAllowedDashboardOrigin,
  resolveAllowedOpenPath,
  resolveContainedExistingPath,
} from '../server/file-open-policy.mjs';
import { GraphMemoryIndex } from '../server/graph-index.mjs';
import { ProjectRegistry, slugifyProjectId } from '../server/project-registry.mjs';
import {
  acquireGenerationLock,
  isIgnoredProjectPath,
  validateGraph,
} from '../server/project-graph-runner.mjs';
import { normalizeToolArguments } from '../server/tool-arguments.mjs';
import { assertStagingGraphPath } from '../scripts/staging-policy.mjs';

test('primer inicio crea un registro vacío sin proyectos personales', () => {
  const studioRoot = mkdtempSync(join(tmpdir(), 'graph-registry-empty-'));
  try {
    mkdirSync(join(studioRoot, 'public'), { recursive: true });
    const registry = new ProjectRegistry({ studioRoot });
    assert.equal(registry.defaultProjectId, null);
    assert.deepEqual(registry.list(), []);
  } finally {
    rmSync(studioRoot, { recursive: true, force: true });
  }
});

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));

function fixture() {
  const studioRoot = mkdtempSync(join(tmpdir(), 'thingforce-registry-'));
  const sourceRoot = join(studioRoot, 'source');
  mkdirSync(join(studioRoot, 'config'), { recursive: true });
  mkdirSync(join(studioRoot, 'public'), { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  const registryPath = join(studioRoot, 'config', 'projects.json');
  writeFileSync(registryPath, JSON.stringify({
    schema_version: 1,
    default_project_id: 'base',
    projects: [{
      id: 'base',
      name: 'Base',
      root: sourceRoot,
      graph_file: 'graph.json',
      color: '#3b82f6',
      protected: true,
    }],
  }));
  return { studioRoot, sourceRoot, registryPath };
}

test('slugifyProjectId normaliza Unicode y separadores', () => {
  assert.equal(slugifyProjectId(' Generador de Vídeos / IA '), 'generador-de-videos-ia');
});

test('registro persiste proyectos y nunca elimina el grafo al desregistrar', () => {
  const fx = fixture();
  try {
    const registry = new ProjectRegistry(fx);
    const secondRoot = join(fx.studioRoot, 'second');
    mkdirSync(secondRoot);
    const created = registry.register({ name: 'Segundo', root: secondRoot });
    const graphPath = registry.graphPath(created);
    mkdirSync(join(fx.studioRoot, 'public', 'projects', created.id), { recursive: true });
    writeFileSync(graphPath, '{}');
    registry.unregister(created.id);
    assert.equal(readFileSync(graphPath, 'utf-8'), '{}');
    assert.equal(new ProjectRegistry(fx).get(created.id), null);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('el registro admite quedar vacío para un primer inicio limpio', () => {
  const fx = fixture();
  try {
    const payload = JSON.parse(readFileSync(fx.registryPath, 'utf-8'));
    payload.projects[0].protected = false;
    writeFileSync(fx.registryPath, JSON.stringify(payload));
    const registry = new ProjectRegistry(fx);
    registry.unregister('base');
    assert.equal(registry.defaultProjectId, null);
    assert.deepEqual(registry.list(), []);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('instancias concurrentes recargan y fusionan el registro más reciente', () => {
  const fx = fixture();
  try {
    const first = new ProjectRegistry(fx);
    const second = new ProjectRegistry(fx);
    const secondRoot = join(fx.studioRoot, 'second');
    mkdirSync(secondRoot);

    const created = first.register({ name: 'Segundo', root: secondRoot });
    assert.equal(second.get(created.id)?.root, secondRoot);

    first.markGenerated('base', { generation_id: 'g-1', nodes: 7 });
    second.markGenerated(created.id, { generation_id: 'g-2', nodes: 11 });

    const finalRegistry = new ProjectRegistry(fx);
    assert.equal(finalRegistry.get('base').graph_summary.generation_id, 'g-1');
    assert.equal(finalRegistry.get(created.id).graph_summary.generation_id, 'g-2');
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('registro rechaza graph_file con traversal', () => {
  const fx = fixture();
  try {
    const registry = new ProjectRegistry(fx);
    const secondRoot = join(fx.studioRoot, 'second');
    mkdirSync(secondRoot);
    assert.throws(
      () => registry.register({ name: 'Escape', root: secondRoot, graph_file: '../escape.json' }),
      /inseguro/,
    );
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('registro rechaza graph_file compartido entre proyectos', () => {
  const fx = fixture();
  try {
    const registry = new ProjectRegistry(fx);
    const secondRoot = join(fx.studioRoot, 'second');
    mkdirSync(secondRoot);
    assert.throws(
      () => registry.register({ name: 'Colisión', root: secondRoot, graph_file: './graph.json' }),
      /graph_file duplicado/,
    );
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('un grafo de otra raíz nunca se anuncia ni se carga como listo', () => {
  const fx = fixture();
  try {
    const otherRoot = join(fx.studioRoot, 'other');
    mkdirSync(otherRoot);
    writeFileSync(join(fx.studioRoot, 'public', 'graph.json'), JSON.stringify({
      root: otherRoot,
      nodes: [{ id: 'file:x', type: 'file', relative_path: 'x.py' }],
      edges: [],
    }));
    const registry = new ProjectRegistry(fx);
    const described = registry.describe(registry.get('base'));
    assert.equal(described.graph_file_exists, true);
    assert.equal(described.graph_exists, false);
    assert.match(described.graph_error, /raíz declarada/);
    assert.throws(() => registry.assertGraphReady('base'), /raíz declarada/);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('registro rechaza una raíz ausente en vez de usar el cwd', () => {
  const fx = fixture();
  try {
    const registry = new ProjectRegistry(fx);
    assert.throws(
      () => registry.register({ name: 'Sin raíz' }),
      /raíz explícita/,
    );
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('una raíz registrada desconectada no impide cargar los demás proyectos', () => {
  const fx = fixture();
  try {
    rmSync(fx.sourceRoot, { recursive: true, force: true });
    const registry = new ProjectRegistry(fx);
    const project = registry.describe(registry.get('base'));
    assert.equal(project.root_exists, false);
    assert.equal(project.graph_exists, false);
    assert.match(project.graph_error, /raíz no está disponible/);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('lock interproceso serializa la generación por proyecto', () => {
  const fx = fixture();
  try {
    const release = acquireGenerationLock(join(fx.studioRoot, 'public'), 'base');
    assert.throws(
      () => acquireGenerationLock(join(fx.studioRoot, 'public'), 'base'),
      /generación activa/,
    );
    release();
    const releaseAgain = acquireGenerationLock(join(fx.studioRoot, 'public'), 'base');
    releaseAgain();
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('release de generación no elimina el lock de un propietario sucesor', () => {
  const fx = fixture();
  try {
    const publicRoot = join(fx.studioRoot, 'public');
    const release = acquireGenerationLock(publicRoot, 'base');
    const lockPath = join(publicRoot, '.locks', 'base.lock');
    const payload = JSON.parse(readFileSync(lockPath, 'utf-8'));
    writeFileSync(lockPath, JSON.stringify({ ...payload, owner_token: 'successor' }));
    release();
    assert.equal(existsSync(lockPath), true);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('validador elimina bridges inferidos sin una definición Ruby', () => {
  const fx = fixture();
  const graphPath = join(fx.studioRoot, 'candidate.json');
  writeFileSync(graphPath, JSON.stringify({
    root: fx.sourceRoot,
    summary: { bridges_detected: ['main'] },
    nodes: [
      { id: 'file:test.py', type: 'file', relative_path: 'test.py' },
      { id: 'bridge:main', type: 'bridge_callback', name: 'main' },
    ],
    edges: [{ from: 'file:test.py', to: 'bridge:main', type: 'calls_bridge_callback' }],
  }));
  try {
    const graph = validateGraph(graphPath, fx.sourceRoot);
    assert.equal(graph.nodes.some((node) => node.id === 'bridge:main'), false);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.summary.false_bridge_nodes_evicted, 1);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('metadatos del grafo excluyen salidas, runtime, respaldos y caches', () => {
  assert.equal(isIgnoredProjectPath('Output_Videos/lote/video.mp4'), true);
  assert.equal(isIgnoredProjectPath('.runtime/run.json'), true);
  assert.equal(isIgnoredProjectPath('Backups/legacy.py'), true);
  assert.equal(isIgnoredProjectPath('src/__pycache__/mod.pyc'), true);
  assert.equal(isIgnoredProjectPath('tutorial_engine/orchestrator.py'), false);

  const fx = fixture();
  const graphPath = join(fx.studioRoot, 'candidate-summary.json');
  writeFileSync(graphPath, JSON.stringify({
    root: fx.sourceRoot,
    summary: {
      changed_files: ['tutorial_engine/orchestrator.py', 'Output_Videos/demo.mp4'],
      reused_files: ['README.md', '.runtime/state.json'],
    },
    nodes: [{ id: 'file:main', type: 'file', relative_path: 'main.py' }],
    edges: [],
  }));
  try {
    const graph = validateGraph(graphPath, fx.sourceRoot);
    assert.deepEqual(graph.summary.changed_files, ['tutorial_engine/orchestrator.py']);
    assert.deepEqual(graph.summary.reused_files, ['README.md']);
  } finally {
    rmSync(fx.studioRoot, { recursive: true, force: true });
  }
});

test('enriquecedores rechazan escritura directa sobre el grafo publicado', () => {
  const scriptsRoot = join(TEST_ROOT, '..', 'scripts');
  assert.throws(
    () => assertStagingGraphPath(undefined, scriptsRoot),
    /ruta explícita de graph\.json/,
  );
  assert.throws(
    () => assertStagingGraphPath(join(TEST_ROOT, '..', 'public', 'graph.json'), scriptsRoot),
    /solo puede escribir dentro de public\/\.staging/,
  );
  assert.throws(
    () => assertStagingGraphPath(join(TEST_ROOT, '..', 'public', '.staging'), scriptsRoot),
    /solo puede escribir dentro de public\/\.staging/,
  );
  assert.throws(
    () => assertStagingGraphPath(
      join(TEST_ROOT, '..', 'public', '.staging', 'candidate', 'otro.json'),
      scriptsRoot,
    ),
    /debe ser un graph\.json de staging/,
  );
  const staged = join(TEST_ROOT, '..', 'public', '.staging', 'candidate', 'graph.json');
  assert.equal(assertStagingGraphPath(staged, scriptsRoot), staged);
});

test('framing Content-Length conserva UTF-8 aunque cada byte llegue separado', () => {
  const input = {
    jsonrpc: '2.0',
    id: 7,
    method: 'initialize',
    params: { clientInfo: { name: 'Diseño 🎬 con ñ' } },
  };
  const encoded = encodeContentLengthMessage(input);
  const decoder = new ContentLengthDecoder();
  const bodies = [];
  for (const byte of encoded) bodies.push(...decoder.push(Buffer.from([byte])));
  assert.equal(bodies.length, 1);
  assert.deepEqual(JSON.parse(bodies[0].toString('utf8')), input);
});

test('framing y argumentos rechazan cargas desproporcionadas', () => {
  const decoder = new ContentLengthDecoder({ maxMessageBytes: 8 });
  assert.throws(
    () => decoder.push(Buffer.from('Content-Length: 9\r\n\r\n')),
    /exceeds the configured limit/,
  );
  assert.throws(
    () => normalizeToolArguments('graph_search', { query: 'x', limit: 10_000 }),
    /limit debe ser un entero entre 1 y 100/,
  );
  assert.throws(
    () => normalizeToolArguments('graph_read', { nodeId: 'x', context: 101 }),
    /context debe ser un entero entre 0 y 100/,
  );
});

test('graph_read y apertura local quedan contenidos en raíces autorizadas', () => {
  const root = mkdtempSync(join(tmpdir(), 'thingforce-containment-'));
  const projectRoot = join(root, 'project');
  const outsidePath = join(root, 'outside.txt');
  const graphPath = join(root, 'graph.json');
  mkdirSync(projectRoot);
  writeFileSync(join(projectRoot, 'safe.txt'), 'seguro');
  writeFileSync(outsidePath, 'secreto');
  writeFileSync(graphPath, JSON.stringify({
    root: projectRoot,
    nodes: [
      { id: 'file:safe', type: 'file', relative_path: 'safe.txt' },
      { id: 'file:escape', type: 'file', relative_path: '../outside.txt' },
    ],
    edges: [],
  }));

  try {
    const index = new GraphMemoryIndex(graphPath);
    assert.match(index.readSource('file:safe').content, /seguro/);
    assert.match(index.readSource('file:escape').error, /fuera de la raíz permitida/);
    assert.equal(resolveContainedExistingPath(projectRoot, 'safe.txt'), join(projectRoot, 'safe.txt'));
    assert.equal(resolveAllowedOpenPath(join(projectRoot, 'safe.txt'), [projectRoot]), join(projectRoot, 'safe.txt'));
    assert.throws(
      () => resolveAllowedOpenPath(outsidePath, [projectRoot]),
      /no pertenece a un proyecto registrado/,
    );
    assert.equal(isAllowedDashboardOrigin('http://localhost:5173'), true);
    assert.equal(isAllowedDashboardOrigin('https://malicioso.example'), false);
    assert.equal(isAllowedDashboardOrigin(undefined), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

function connectionRejected(port) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      reject(new Error(`El modo stdio abrió inesperadamente el puerto ${port}`));
    });
    socket.once('error', () => resolvePromise());
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Timeout comprobando el puerto HTTP'));
    });
  });
}

function rawHttpRequest(port, path) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let response = '';
    socket.setTimeout(3_000);
    socket.once('connect', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
    socket.once('end', () => resolvePromise(response));
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Timeout en solicitud HTTP cruda'));
    });
  });
}

test('HTTP rechaza URI malformada sin derribar el servidor', { timeout: 45_000 }, async () => {
  const port = await reservePort();
  const serverPath = join(TEST_ROOT, '..', 'server', 'mcp-server.mjs');
  const child = spawn(process.execPath, [serverPath], {
    cwd: TEST_ROOT,
    env: { ...process.env, ENABLE_SOLARGRAPH: '0', MCP_HTTP_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  try {
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`HTTP no inició: ${stderr}`)), 30_000);
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
        if (stderr.includes('HTTP API ready')) {
          clearTimeout(timeout);
          resolvePromise();
        }
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== null && code !== 0) reject(new Error(`HTTP terminó con ${code}: ${stderr}`));
      });
    });
    const malformed = await rawHttpRequest(port, '/api/projects/%E0%A4%A');
    assert.match(malformed, /^HTTP\/1\.1 400/);
    const healthy = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(healthy.status, 200);
    const forbiddenPicker = await fetch(`http://127.0.0.1:${port}/api/select-folder`, {
      method: 'POST',
    });
    assert.equal(forbiddenPicker.status, 403);
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});

test('mcp --stdio usa la raíz del módulo, mantiene stdout limpio y no abre HTTP', { timeout: 15_000 }, async () => {
  const port = await reservePort();
  const cwd = mkdtempSync(join(tmpdir(), 'thingforce-foreign-cwd-'));
  const serverPath = join(TEST_ROOT, '..', 'server', 'mcp-server.mjs');
  const child = spawn(process.execPath, [serverPath, '--stdio'], {
    cwd,
    env: {
      ...process.env,
      ENABLE_SOLARGRAPH: '0',
      MCP_HTTP_PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const decoder = new ContentLengthDecoder();
  let stderr = '';

  try {
    const responsePromise = new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Sin respuesta MCP. stderr: ${stderr}`)), 8_000);
      child.stdout.on('data', (chunk) => {
        try {
          const messages = decoder.push(chunk);
          if (!messages.length) return;
          clearTimeout(timeout);
          resolvePromise(JSON.parse(messages[0].toString('utf8')));
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== null && code !== 0) reject(new Error(`MCP terminó con ${code}. stderr: ${stderr}`));
      });
    });

    const request = encodeContentLengthMessage({
      jsonrpc: '2.0',
      id: 42,
      method: 'initialize',
      params: { clientInfo: { name: 'Cliente vídeo 🎬' } },
    });
    child.stdin.write(request.subarray(0, request.length - 2));
    child.stdin.write(request.subarray(request.length - 2));
    const response = await responsePromise;
    assert.equal(response.id, 42);
    assert.equal(response.result.serverInfo.name, 'thingforce-graph');
    await connectionRejected(port);
    assert.match(stderr, /Solargraph disabled/);
    assert.match(stderr, /MCP stdio mode active/);
    assert.doesNotMatch(stderr, /HTTP API ready/);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(cwd, { recursive: true, force: true });
  }
});
