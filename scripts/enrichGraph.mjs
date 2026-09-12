/**
 * Graph Enricher — Pipeline post-generación
 * 
 * Lee graph.json y lo enriquece con:
 *   1. Nodos de ASSET (png, svg, jpg, ico, gif, webp, mp4, pdf, skp, skm)
 *   2. Nodos de CARPETA jerárquicos
 *   3. Aristas file→asset (references_asset) que el scanner Ruby no pudo resolver
 *   4. Aristas carpeta→hijo (contains)
 * 
 * Uso:  node scripts/enrichGraph.mjs <ruta_plugin> <public/.staging/.../graph.json>
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, relative, dirname, extname, basename } from 'path';
import { assertStagingGraphPath } from './staging-policy.mjs';

const ASSET_EXTENSIONS = new Set([
  '.png', '.svg', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.pdf', '.skp', '.skm', '.ttf', '.woff', '.woff2', '.eot',
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git', '.idea', '.vscode', '.venv', 'venv', 'env', 'node_modules',
  'dist', 'build', 'coverage', 'temp', 'backups', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.runtime', '.staging', 'output_videos',
]);

function isIgnoredRelativePath(relPath) {
  const normalized = relPath.replace(/\\/g, '/').toLowerCase();
  const parts = normalized.split('/');
  return parts.some(part => IGNORED_DIRECTORY_NAMES.has(part)) || normalized.includes('.bak');
}

// ── 1. Leer argumentos ──────────────────────────────────────────────
const pluginRoot = process.argv[2];
const graphPathArgument = process.argv[3];

if (!pluginRoot || !graphPathArgument) {
  console.error('Uso: node scripts/enrichGraph.mjs <ruta_plugin> <public/.staging/.../graph.json>');
  process.exit(1);
}
const graphPath = assertStagingGraphPath(graphPathArgument, import.meta.dirname);

console.log(`[enricher] Plugin root : ${pluginRoot}`);
console.log(`[enricher] Graph path  : ${graphPath}`);

// ── 2. Leer grafo existente ──────────────────────────────────────────
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const existingNodeIds = new Set(graph.nodes.map(n => n.id));
const existingEdgeKeys = new Set(graph.edges.map(e => `${e.from}|${e.to}|${e.type}`));

let addedAssetNodes = 0;
let addedFolderNodes = 0;
let addedAssetEdges = 0;
let addedContainsEdges = 0;

// ── 3. Escanear TODOS los archivos del plugin ────────────────────────
function walkDir(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch { /* permission errors, skip */ }
  return results;
}

const allFiles = walkDir(pluginRoot);
const allRelPaths = allFiles.map(f => relative(pluginRoot, f).replace(/\\/g, '/'));

// Map of relative path → true for quick lookups
const relPathSet = new Set(allRelPaths);

// ── 3b. Eviction Engine (Purgar basura y fantasmas) ──────────────────
const initialNodeCount = graph.nodes.length;
const initialEdgeCount = graph.edges.length;

graph.nodes = graph.nodes.filter(n => {
  let relPath = n.relative_path;
  // If it doesn't have a direct relative_path (like a function or data node), check its parent
  if (!relPath && n.id.startsWith('fn:')) {
    relPath = n.id.split('::')[0].replace('fn:', '');
  }
  if (!relPath && n.id.startsWith('data:')) {
    // Data flow nodes might not have a direct file mapping, keep them if valid
    return true; 
  }
  
  if (!relPath) return true; // Keep virtual nodes without any file binding
  
  // Hard purge ignored patterns
  if (isIgnoredRelativePath(relPath)) {
    return false;
  }
  
  return relPathSet.has(relPath);
});

// Remove edges connected to evicted nodes
const validNodeIds = new Set(graph.nodes.map(n => n.id));
graph.edges = graph.edges.filter(e => validNodeIds.has(e.from) && validNodeIds.has(e.to));

const evictedNodes = initialNodeCount - graph.nodes.length;
const evictedEdges = initialEdgeCount - graph.edges.length;
console.log(`[enricher] 🗑️ Evicted ${evictedNodes} stale nodes and ${evictedEdges} stale edges.`);

// Rebuild sets after eviction
existingNodeIds.clear();
for (const n of graph.nodes) existingNodeIds.add(n.id);
existingEdgeKeys.clear();
for (const e of graph.edges) existingEdgeKeys.add(`${e.from}|${e.to}|${e.type}`);

// ── 4. Añadir nodos de ASSET que faltan ──────────────────────────────
for (const relPath of allRelPaths) {
  const ext = extname(relPath).toLowerCase();
  const nodeId = `file:${relPath}`;

  if (ASSET_EXTENSIONS.has(ext) && !existingNodeIds.has(nodeId)) {
    // Determine module name
    let moduleName = null;
    const moduleMatch = relPath.match(/^modules\/([^/]+)\//);
    if (moduleMatch) moduleName = moduleMatch[1];

    graph.nodes.push({
      id: nodeId,
      type: 'asset',
      relative_path: relPath,
      classification: {
        language: ext.slice(1),
        extension: ext,
        layer: relPath.startsWith('modules/') ? 'plugin_modules' : 'supporting_surface',
        module_name: moduleName,
        labels: ['asset_file'],
      },
    });

    existingNodeIds.add(nodeId);
    addedAssetNodes++;
  }
}

// ── 5. Resolver aristas de assets rotas ──────────────────────────────
// Re-scan all nodes that have relative_path_tokens or assets
for (const node of graph.nodes) {
  if (node.type !== 'file') continue;

  const tokens = [
    ...(node.general?.relative_path_tokens || []),
    ...(node.specialized?.assets || []),
  ];

  const nodeRelPath = node.relative_path || node.id.replace('file:', '');

  for (const token of tokens) {
    if (!token || token.startsWith('data:') || token.startsWith('http') || token.startsWith('#')) continue;

    // Try to resolve the token relative to the node's directory
    const baseDir = dirname(nodeRelPath);
    const candidate = join(baseDir, token).replace(/\\/g, '/').replace(/^\.\//, '');
    // Normalize .. segments
    const parts = candidate.split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.') resolved.push(p);
    }
    const resolvedPath = resolved.join('/');
    const targetId = `file:${resolvedPath}`;

    if (existingNodeIds.has(targetId)) {
      const edgeKey = `${node.id}|${targetId}|references_asset`;
      if (!existingEdgeKeys.has(edgeKey)) {
        graph.edges.push({
          from: node.id,
          to: targetId,
          type: 'references_asset',
          metadata: { raw: token },
        });
        existingEdgeKeys.add(edgeKey);
        addedAssetEdges++;
      }
    }
  }
}

// ── 6. Construir nodos de CARPETA jerárquicos ────────────────────────
const folderChildCounts = new Map();

for (const relPath of allRelPaths) {
  let dir = dirname(relPath);
  while (dir && dir !== '.') {
    folderChildCounts.set(dir, (folderChildCounts.get(dir) || 0) + 1);
    dir = dirname(dir);
  }
}

for (const [folderPath, childCount] of folderChildCounts) {
  const folderId = `folder:${folderPath}`;
  if (existingNodeIds.has(folderId)) continue;

  let moduleName = null;
  const moduleMatch = folderPath.match(/^modules\/([^/]+)/);
  if (moduleMatch) moduleName = moduleMatch[1];

  graph.nodes.push({
    id: folderId,
    type: 'folder',
    relative_path: folderPath,
    name: basename(folderPath),
    child_count: childCount,
    classification: {
      language: 'directory',
      extension: '',
      layer: folderPath.startsWith('modules/') ? 'plugin_modules' : 'supporting_surface',
      module_name: moduleName,
      labels: ['directory'],
    },
  });

  existingNodeIds.add(folderId);
  addedFolderNodes++;
}

// ── 7. Aristas folder→child (contains) ──────────────────────────────
for (const node of graph.nodes) {
  const relPath = node.relative_path;
  if (!relPath) continue;

  const parentDir = dirname(relPath);
  if (!parentDir || parentDir === '.') continue;

  const parentId = node.type === 'folder' 
    ? `folder:${parentDir}` 
    : `folder:${parentDir}`;
  
  if (existingNodeIds.has(parentId)) {
    const edgeKey = `${parentId}|${node.id}|contains`;
    if (!existingEdgeKeys.has(edgeKey)) {
      graph.edges.push({
        from: parentId,
        to: node.id,
        type: 'contains',
      });
      existingEdgeKeys.add(edgeKey);
      addedContainsEdges++;
    }
  }
}

// ── 8. Actualizar summary ────────────────────────────────────────────
graph.summary.nodes_total = graph.nodes.length;
graph.summary.edges_total = graph.edges.length;
graph.summary.enricher = {
  ran_at: new Date().toISOString(),
  evicted_nodes: evictedNodes,
  evicted_edges: evictedEdges,
  added_asset_nodes: addedAssetNodes,
  added_folder_nodes: addedFolderNodes,
  added_asset_edges: addedAssetEdges,
  added_contains_edges: addedContainsEdges,
};

// ── 9. Escribir grafo enriquecido ────────────────────────────────────
writeFileSync(graphPath, JSON.stringify(graph));

console.log(`[enricher] ✓ Asset nodes added   : ${addedAssetNodes}`);
console.log(`[enricher] ✓ Folder nodes added  : ${addedFolderNodes}`);
console.log(`[enricher] ✓ Asset edges added   : ${addedAssetEdges}`);
console.log(`[enricher] ✓ Contains edges added: ${addedContainsEdges}`);
console.log(`[enricher] ✓ Total nodes: ${graph.nodes.length}, Total edges: ${graph.edges.length}`);
console.log(`[enricher] ✓ Written to: ${graphPath}`);
