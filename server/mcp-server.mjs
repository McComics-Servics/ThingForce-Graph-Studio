#!/usr/bin/env node
/**
 * ThingForce™ Graph MCP Server
 * 
 * Model Context Protocol server that exposes the code graph as queryable tools.
 * Works with: Antigravity, Claude Desktop, VS Code, Cline, etc.
 * 
 * Protocols supported:
 *   - MCP over stdio (for IDE integration)
 *   - HTTP REST API on port 3098 (for Dashboard and direct queries)
 * 
 * Usage:
 *   node server/mcp-server.mjs                    # Uses env vars
 *   GRAPH_PATH=./public/graph.json node server/mcp-server.mjs
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { GraphMemoryIndex } from './graph-index.mjs';
import { LspClient } from './lsp-client.mjs';
import { ProjectRegistry } from './project-registry.mjs';
import { generateProjectGraph } from './project-graph-runner.mjs';
import { GitHubLocalAuth } from './github-local-auth.mjs';
import {
  ContentLengthDecoder,
  encodeContentLengthMessage,
} from './content-length-framing.mjs';
import { boundedInteger, normalizeToolArguments } from './tool-arguments.mjs';
import { isAllowedDashboardOrigin } from './file-open-policy.mjs';

// ── Config ──────────────────────────────────────────────────────────
const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH_PATH = process.env.GRAPH_PATH || '';
const PLUGIN_ROOT = process.env.PLUGIN_ROOT || '';
const DEFAULT_PROJECT_ID = process.env.GRAPH_PROJECT_ID || '';
const HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || '3098', 10);
const MODE = process.argv.includes('--stdio') ? 'stdio' : 'http';

// ── Multi-project registry and lazy indices ─────────────────────────
const registry = new ProjectRegistry({ studioRoot: STUDIO_ROOT });
const githubAuth = new GitHubLocalAuth({ studioRoot: STUDIO_ROOT });
const indexByProject = new Map();
const generationLocks = new Map();
const lspProjectId = DEFAULT_PROJECT_ID || registry.defaultProjectId;

function selectedDefaultProjectId() {
  return DEFAULT_PROJECT_ID || registry.defaultProjectId;
}

function graphFileStamp(graphPath) {
  const stat = statSync(graphPath);
  return `${stat.size}:${stat.mtimeMs}`;
}

function projectIndex(projectId = selectedDefaultProjectId(), { reload = false } = {}) {
  registry.reloadIfChanged();
  const project = registry.get(projectId);
  if (!project) throw new Error(`Proyecto no registrado: ${projectId}`);
  const graphPath = registry.assertGraphReady(project);
  const stamp = graphFileStamp(graphPath);
  const cached = indexByProject.get(project.id);
  if (
    !reload
    && cached
    && cached.graphPath === graphPath
    && cached.stamp === stamp
  ) {
    return cached.index;
  }
  const loaded = new GraphMemoryIndex(graphPath);
  loaded.root = project.root;
  indexByProject.set(project.id, { graphPath, stamp, index: loaded });
  return loaded;
}

let legacyIndex = null;
if (GRAPH_PATH && existsSync(GRAPH_PATH)) {
  legacyIndex = new GraphMemoryIndex(GRAPH_PATH);
  if (PLUGIN_ROOT) legacyIndex.root = PLUGIN_ROOT;
}

function resolveIndex(projectId) {
  if (!projectId && legacyIndex) return legacyIndex;
  return projectIndex(projectId || selectedDefaultProjectId());
}

console.error(`[mcp-server] Default project: ${selectedDefaultProjectId()}`);
console.error(`[mcp-server] Registered projects: ${registry.list().map(project => project.id).join(', ')}`);

// ── Initialize LSP ──────────────────────────────────────────────────
let lspClient = null;
const lspRoot = PLUGIN_ROOT || registry.get(lspProjectId)?.root || '';
if (process.env.ENABLE_SOLARGRAPH === '1' && lspRoot) {
  const solargraphCommand = process.env.SOLARGRAPH_COMMAND || 'solargraph';
  lspClient = new LspClient(solargraphCommand, ['stdio'], lspRoot);
  lspClient.initialize().catch(err => {
    console.error('[mcp-server] ⚠️ Solargraph LSP failed to start (is it installed?). LSP features will be disabled. Error:', err.message);
    lspClient = null;
  });
} else {
  console.error('[mcp-server] Solargraph disabled (set ENABLE_SOLARGRAPH=1 to opt in).');
}

async function regenerateProject(projectId, force = true) {
  const project = registry.get(projectId);
  if (!project) throw new Error(`Proyecto no registrado: ${projectId}`);
  if (generationLocks.has(project.id)) return generationLocks.get(project.id);
  const operation = generateProjectGraph({
    project,
    graphPath: registry.graphPath(project),
    studioRoot: STUDIO_ROOT,
    publicRoot: registry.publicRoot,
    force,
  })
    .then((summary) => {
      registry.markGenerated(project.id, summary);
      projectIndex(project.id, { reload: true });
      return summary;
    })
    .catch((error) => {
      registry.markError(project.id, error);
      throw error;
    })
    .finally(() => generationLocks.delete(project.id));
  generationLocks.set(project.id, operation);
  return operation;
}

// ── Tool definitions ────────────────────────────────────────────────
const PROJECT_ID_PROPERTY = {
  type: 'string',
  description: 'Registered project ID. Omit to use the configured default project.',
};

const TOOLS = [
  {
    name: 'graph_projects',
    description: 'List registered code graphs and their availability before querying a multi-project workspace.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'graph_search',
    description: 'Search the code graph for nodes (files, functions, bridges, assets) by fuzzy name match. Use this to find relevant code elements before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        query: { type: 'string', description: 'Search term (fuzzy match on name, path, id). Examples: "correderas", "plano_tool", "main.rb"' },
        type: { type: 'string', enum: ['file', 'function', 'bridge_callback', 'asset', 'folder'], description: 'Filter by node type (optional)' },
        module: { type: 'string', description: 'Filter by module name, e.g. "cajonera_pro" (optional)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'graph_trace',
    description: 'Trace the dependency chain from a node. Returns all upstream (who depends on this) and downstream (what this depends on) nodes. Use this to understand the full execution chain from UI to backend.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        nodeId: { type: 'string', description: 'The node ID to trace from (e.g., "file:modules/cajonera/ui/parametric_dialog.rb" or "bridge:set_corredera")' },
        depth: { type: 'number', description: 'Max hops to traverse (default 4)' },
        direction: { type: 'string', enum: ['both', 'upstream', 'downstream'], description: 'Direction to trace (default: both)' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'graph_impact',
    description: 'Analyze the impact of changing a file or function. Returns all affected nodes with a severity score (0-100). Use this BEFORE making changes to understand the blast radius.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        nodeId: { type: 'string', description: 'The node to analyze impact for' },
        depth: { type: 'number', description: 'Max hops (default 3)' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'graph_bridge',
    description: 'Get the full schema of a bridge callback, including block parameters, payload keys, and connected nodes. Use this to understand what data flows through a Ruby-JS bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        name: { type: 'string', description: 'Bridge callback name, e.g. "set_corredera", "crear_modulo_especial"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'graph_node',
    description: 'Get detailed information about a specific node, including all its connections and child functions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        id: { type: 'string', description: 'The full node ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'graph_read',
    description: 'Read the source code lines for a node. Returns the relevant lines from the file with context. Use this to see the actual code implementation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        nodeId: { type: 'string', description: 'Node ID to read source for' },
        context: { type: 'number', description: 'Number of context lines before/after (default 5)' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'lsp_definition',
    description: 'Use the Language Server (Solargraph) to find the exact definition of a symbol at the given file, line, and character (0-indexed). Returns the precise file and range where the class, method, or variable is defined.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        file: { type: 'string', description: 'Relative path to the file in the plugin root' },
        line: { type: 'number', description: '0-indexed line number' },
        char: { type: 'number', description: '0-indexed character position' }
      },
      required: ['file', 'line', 'char'],
    },
  },
  {
    name: 'lsp_references',
    description: 'Use the Language Server (Solargraph) to find all real references of a symbol at the given file, line, and character (0-indexed). This provides 100% accurate context-aware references compared to simple text search.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID_PROPERTY,
        file: { type: 'string', description: 'Relative path to the file in the plugin root' },
        line: { type: 'number', description: '0-indexed line number' },
        char: { type: 'number', description: '0-indexed character position' }
      },
      required: ['file', 'line', 'char'],
    },
  },
];

// ── Tool execution ──────────────────────────────────────────────────
async function executeTool(name, args) {
  let safeArgs;
  try {
    safeArgs = normalizeToolArguments(name, args || {});
  } catch (error) {
    return { error: error.message };
  }
  if (name === 'graph_projects') {
    return {
      default_project_id: selectedDefaultProjectId(),
      projects: registry.list(),
    };
  }
  const index = resolveIndex(safeArgs.projectId);
  switch (name) {
    case 'graph_search':
      return index.search(safeArgs.query, safeArgs.type, safeArgs.module, safeArgs.limit);
    case 'graph_trace':
      return index.trace(safeArgs.nodeId, safeArgs.depth, safeArgs.direction);
    case 'graph_impact':
      return index.impact(safeArgs.nodeId, safeArgs.depth);
    case 'graph_bridge':
      return index.bridge(safeArgs.name) || { error: `Bridge "${safeArgs.name}" not found` };
    case 'graph_node':
      return index.getNode(safeArgs.id) || { error: `Node "${safeArgs.id}" not found` };
    case 'graph_read':
      return index.readSource(safeArgs.nodeId, safeArgs.context) || { error: `Cannot read source for "${safeArgs.nodeId}"` };
    case 'lsp_definition':
      if (safeArgs.projectId && safeArgs.projectId !== lspProjectId) return { error: 'Solargraph está ligado al proyecto predeterminado.' };
      if (!lspClient) return { error: 'LSP is not available. Please install Solargraph.' };
      try { return await lspClient.definition(safeArgs.file, safeArgs.line, safeArgs.char); } catch(e) { return { error: e.message }; }
    case 'lsp_references':
      if (safeArgs.projectId && safeArgs.projectId !== lspProjectId) return { error: 'Solargraph está ligado al proyecto predeterminado.' };
      if (!lspClient) return { error: 'LSP is not available. Please install Solargraph.' };
      try { return await lspClient.references(safeArgs.file, safeArgs.line, safeArgs.char); } catch(e) { return { error: e.message }; }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readRequestJson(req, maxBytes = 1_000_000) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > maxBytes) {
        rejected = true;
        const error = new Error(`Solicitud demasiado grande (máximo ${maxBytes} bytes)`);
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolvePromise(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function openNativeFolderPicker(callback) {
  const options = { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 };
  if (process.platform === 'win32') {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = 'Selecciona la carpeta raíz del proyecto'
      $dialog.ShowNewFolderButton = $true
      $form = New-Object System.Windows.Forms.Form
      $form.TopMost = $true
      if ($dialog.ShowDialog($form) -eq 'OK') { Write-Output $dialog.SelectedPath }
      $form.Dispose()
    `;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', [
      '-Sta', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded,
    ], options, callback);
    return;
  }
  if (process.platform === 'darwin') {
    execFile('osascript', [
      '-e', 'POSIX path of (choose folder with prompt "Selecciona la carpeta raíz del proyecto")',
    ], options, callback);
    return;
  }
  if (process.platform === 'linux') {
    execFile('zenity', [
      '--file-selection', '--directory', '--title=Selecciona la carpeta raíz del proyecto',
    ], options, callback);
    return;
  }
  const error = new Error('Selector gráfico no disponible; escribe la ruta manualmente');
  error.code = 'UNSUPPORTED_PLATFORM';
  callback(error, '');
}

// ── HTTP REST API ───────────────────────────────────────────────────
function createHttpApiServer() {
  return createServer((req, res) => {
  try {
  const origin = req.headers.origin;
  if (origin && !isAllowedDashboardOrigin(origin)) {
    sendJson(res, 403, { error: 'Origen de navegador no autorizado' });
    return;
  }
  if (isAllowedDashboardOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Parse URL
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  const path = url.pathname;

  if (path === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      pid: process.pid,
      instance_token: process.env.DASHBOARD_INSTANCE_TOKEN || null,
    });
    return;
  }

  if (path === '/api/projects' && req.method === 'GET') {
    sendJson(res, 200, {
      default_project_id: registry.defaultProjectId,
      projects: registry.list(),
    });
    return;
  }

  if (path === '/api/projects' && req.method === 'POST') {
    readRequestJson(req, 64 * 1024)
      .then(async (input) => {
        const project = registry.register({
          name: input.name,
          id: input.id,
          root: input.root,
          color: input.color,
          protected: false,
          generator: 'thingforce_local_generic',
        });
        const summary = await regenerateProject(project.id, true);
        sendJson(res, 201, { project: registry.describe(registry.get(project.id)), summary });
      })
      .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
    return;
  }

  if (path === '/api/github/status' && req.method === 'GET') {
    githubAuth.status()
      .then((status) => sendJson(res, 200, status))
      .catch((error) => sendJson(res, error.statusCode || 500, { error: error.message }));
    return;
  }

  if (path === '/api/github/device/start' && req.method === 'POST') {
    githubAuth.startDeviceFlow()
      .then((flow) => sendJson(res, 201, flow))
      .catch((error) => sendJson(res, error.statusCode || 502, { error: error.message }));
    return;
  }

  if (path === '/api/github/device/poll' && req.method === 'POST') {
    readRequestJson(req, 8 * 1024)
      .then((input) => githubAuth.pollDeviceFlow(input.flow_id))
      .then((result) => sendJson(res, result.status === 'pending' ? 202 : 200, result))
      .catch((error) => sendJson(res, error.statusCode || 502, { error: error.message }));
    return;
  }

  if (path === '/api/github/repositories' && req.method === 'GET') {
    githubAuth.repositories()
      .then((repositories) => sendJson(res, 200, { repositories }))
      .catch((error) => sendJson(res, error.statusCode || 502, { error: error.message }));
    return;
  }

  if (path === '/api/github/import' && req.method === 'POST') {
    readRequestJson(req, 16 * 1024)
      .then(async (input) => {
        const imported = await githubAuth.importRepository(input.full_name);
        const existing = registry.list().find(
          (project) => resolve(project.root).toLowerCase() === resolve(imported.root).toLowerCase(),
        );
        const project = existing || registry.register({
          id: imported.repository.full_name,
          name: imported.repository.full_name,
          root: imported.root,
          color: '#22d3ee',
          protected: false,
          generator: 'thingforce_local_generic',
        });
        const summary = await regenerateProject(project.id, true);
        sendJson(res, existing ? 200 : 201, {
          project: registry.describe(registry.get(project.id)),
          repository: imported.repository,
          cloned: imported.cloned,
          summary,
        });
      })
      .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
    return;
  }

  if (path === '/api/github/logout' && req.method === 'POST') {
    sendJson(res, 200, githubAuth.logout());
    return;
  }

  const projectRoute = path.match(/^\/api\/projects\/([^/]+)(?:\/(graph|refresh))?$/);
  if (projectRoute) {
    const projectId = decodeURIComponent(projectRoute[1]);
    const action = projectRoute[2] || null;
    const project = registry.get(projectId);
    if (!project) {
      sendJson(res, 404, { error: `Proyecto no registrado: ${projectId}` });
      return;
    }

    if (action === 'graph' && req.method === 'GET') {
      const status = registry.graphStatus(project);
      if (!status.ready) {
        sendJson(res, status.exists ? 409 : 404, { error: status.error });
        return;
      }
      const graphPath = registry.graphPath(project);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(readFileSync(graphPath));
      return;
    }

    if (action === 'refresh' && req.method === 'POST') {
      const force = ['1', 'true', 'yes'].includes(
        String(url.searchParams.get('force') || '').toLowerCase(),
      );
      regenerateProject(projectId, force)
        .then((summary) => sendJson(res, 200, {
          project: registry.describe(registry.get(projectId)),
          summary,
        }))
        .catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }

    if (!action && req.method === 'DELETE') {
      try {
        const removed = registry.unregister(projectId);
        indexByProject.delete(projectId);
        sendJson(res, 200, {
          removed: removed.id,
          files_preserved: true,
          default_project_id: registry.defaultProjectId,
        });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }
  }

  // GET /openapi.json — OpenAPI schema for Custom GPTs
  if (path === '/openapi.json' && req.method === 'GET') {
    try {
      const schema = readFileSync(join(STUDIO_ROOT, 'openapi.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(schema);
    } catch {
      res.writeHead(404);
      res.end('openapi.json not found');
    }
    return;
  }

  // GET /.well-known/ai-plugin.json — ChatGPT plugin manifest
  if (path === '/.well-known/ai-plugin.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      schema_version: 'v1',
      name_for_human: 'ThingForce Graph',
      name_for_model: 'thingforce_graph',
      description_for_human: 'Consulta el grafo de dependencias de tu código para hacer cambios seguros.',
      description_for_model: 'Query registered local code graphs. Select projectId explicitly, then use graph_search, graph_trace, graph_impact, graph_bridge, and graph_read.',
      auth: { type: 'none' },
      api: { type: 'openapi', url: `http://localhost:${HTTP_PORT}/openapi.json` },
      logo_url: `http://localhost:${HTTP_PORT}/logo.svg`,
      contact_email: 'mccomicsservics@gmail.com',
      legal_info_url: 'https://grupomccomics.com/mccomicsup/legal/',
    }));
    return;
  }

  if (path === '/logo.svg' && req.method === 'GET') {
    const logo = readFileSync(join(STUDIO_ROOT, 'public', 'favicon.svg'));
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
    res.end(logo);
    return;
  }

  // POST /api/select-folder — side effect restricted to the local Dashboard.
  if (path === '/api/select-folder' && req.method === 'POST') {
    if (!isAllowedDashboardOrigin(origin)) {
      sendJson(res, 403, { error: 'El selector requiere el origen local del Dashboard' });
      return;
    }
    openNativeFolderPicker((error, stdout) => {
        if (error) {
          sendJson(res, error.code === 'UNSUPPORTED_PLATFORM' ? 501 : 500, {
            error: error.code === 'UNSUPPORTED_PLATFORM'
              ? error.message
              : 'No se pudo abrir el selector de carpetas',
          });
          return;
        }
        sendJson(res, 200, { path: stdout ? stdout.trim() : null });
      });
    return;
  }

  // GET /api/tools — list available tools
  if (path === '/api/tools' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools: TOOLS }));
    return;
  }

  // GET /api/stats — graph statistics
  if (path === '/api/stats' && req.method === 'GET') {
    try {
      const index = resolveIndex(url.searchParams.get('project'));
      sendJson(res, 200, {
        nodes: index.nodes.length,
        edges: index.edges.length,
        functions: index.functionsByName.size,
        bridges: index.bridgeByName.size,
        summary: index.summary,
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/call — execute a tool
  if (path === '/api/call' && req.method === 'POST') {
    readRequestJson(req, 128 * 1024)
      .then(async ({ tool, args }) => {
        const result = await executeTool(tool, args || {});
        sendJson(res, 200, result);
      })
      .catch((error) => sendJson(res, error.statusCode || 400, { error: error.message }));
    return;
  }

  // Convenience GET routes
  if (path.startsWith('/api/search') && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || null;
    const module = url.searchParams.get('module') || null;
    try {
      const limit = boundedInteger(url.searchParams.get('limit'), 20, { min: 1, max: 100, label: 'limit' });
      const index = resolveIndex(url.searchParams.get('project'));
      sendJson(res, 200, index.search(q, type, module, limit));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (path.startsWith('/api/bridge/') && req.method === 'GET') {
    const name = decodeURIComponent(path.replace('/api/bridge/', ''));
    try {
      const index = resolveIndex(url.searchParams.get('project'));
      const result = index.bridge(name);
      sendJson(res, result ? 200 : 404, result || { error: 'Not found' });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (path.startsWith('/api/impact/') && req.method === 'GET') {
    const nodeId = decodeURIComponent(path.replace('/api/impact/', ''));
    try {
      const depth = boundedInteger(url.searchParams.get('depth'), 3, { min: 1, max: 10, label: 'depth' });
      const index = resolveIndex(url.searchParams.get('project'));
      sendJson(res, 200, index.impact(nodeId, depth));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

    res.writeHead(404); res.end('Not found');
  } catch (error) {
    const status = error instanceof URIError || error?.code === 'ERR_INVALID_URL'
      ? 400
      : ['ENOENT', 'EBUSY', 'EPERM'].includes(error?.code) ? 503 : 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: error.message || 'Error HTTP interno' });
    } else {
      res.destroy();
    }
  }
  });
}

if (MODE === 'http') {
  const httpServer = createHttpApiServer();
  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.error(`[mcp-server] HTTP API ready on http://127.0.0.1:${HTTP_PORT}`);
    console.error(`[mcp-server] Try: http://127.0.0.1:${HTTP_PORT}/api/projects`);
  });
}

// ── MCP stdio protocol (for IDE integration) ────────────────────────
if (MODE === 'stdio') {
  const decoder = new ContentLengthDecoder();
  process.stdin.on('data', (chunk) => {
    try {
      for (const body of decoder.push(chunk)) {
        try {
          const msg = JSON.parse(body.toString('utf8'));
          void handleMCPMessage(msg);
        } catch (error) {
          console.error('[mcp-server] Parse error:', error.message);
        }
      }
    } catch (error) {
      console.error('[mcp-server] Framing error:', error.message);
    }
  });

  function sendMCP(response) {
    process.stdout.write(encodeContentLengthMessage(response));
  }

  async function handleMCPMessage(msg) {
    try {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        throw new Error('El mensaje JSON-RPC debe ser un objeto');
      }
      if (msg.method === 'initialize') {
        sendMCP({
          jsonrpc: '2.0', id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'thingforce-graph', version: '1.0.0' },
          },
        });
      } else if (msg.method === 'notifications/initialized') {
        // Client acknowledged — no response needed
      } else if (msg.method === 'tools/list') {
        sendMCP({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      } else if (msg.method === 'tools/call') {
        if (!msg.params || typeof msg.params.name !== 'string') {
          throw new Error('tools/call requiere params.name');
        }
        const { name, arguments: args } = msg.params;
        const result = await executeTool(name, args || {});
        sendMCP({
          jsonrpc: '2.0', id: msg.id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
        });
      } else {
        sendMCP({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown method: ${msg.method}` } });
      }
    } catch (error) {
      if (msg?.id !== undefined) {
        sendMCP({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: error.message },
        });
      } else {
        console.error('[mcp-server] MCP request error:', error.message);
      }
    }
  }

  console.error('[mcp-server] MCP stdio mode active. Waiting for IDE connection...');
}
