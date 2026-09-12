/**
 * Graph Index — In-memory O(1) lookup tables for the MCP server.
 * Loads graph.json once and builds multiple indices for fast queries.
 */

import { readFileSync } from 'fs';
import Fuse from 'fuse.js';
import { resolveContainedExistingPath } from './file-open-policy.mjs';

export class GraphMemoryIndex {
  constructor(graphPath) {
    const raw = JSON.parse(readFileSync(graphPath, 'utf-8'));
    
    // Server-side safety filter: Immediately drop known garbage just in case indexer missed it
    this.nodes = (raw.nodes || []).filter(n => {
      const p = n.relative_path || n.parent_file || '';
      return !p.includes('Temp/') && !p.includes('.bak') && !p.includes('node_modules/') && !p.includes('.git/');
    });
    
    const validIds = new Set(this.nodes.map(n => n.id));
    this.edges = (raw.edges || []).filter(e => validIds.has(e.from) && validIds.has(e.to));
    
    this.summary = raw.summary || {};
    this.root = raw.root || '';

    // O(1) by ID
    this.nodeById = new Map();
    for (const n of this.nodes) this.nodeById.set(n.id, n);

    // O(1) edges by source/target
    this.outgoing = new Map();
    this.incoming = new Map();
    for (const e of this.edges) {
      const out = this.outgoing.get(e.from);
      if (out) out.push(e); else this.outgoing.set(e.from, [e]);
      const inc = this.incoming.get(e.to);
      if (inc) inc.push(e); else this.incoming.set(e.to, [e]);
    }

    // Functions by name (for fast function lookup)
    this.functionsByName = new Map();
    for (const n of this.nodes) {
      if (n.type === 'function' || n.type === 'bridge_callback' || n.type === 'js_function') {
        const name = n.name || '';
        const list = this.functionsByName.get(name) || [];
        list.push(n);
        this.functionsByName.set(name, list);
      }
    }

    // Functions by file
    this.functionsByFile = new Map();
    for (const n of this.nodes) {
      if (n.type === 'function' && n.parent_file) {
        const list = this.functionsByFile.get(n.parent_file) || [];
        list.push(n);
        this.functionsByFile.set(n.parent_file, list);
      }
    }

    // Bridge schemas by name
    this.bridgeByName = new Map();
    for (const n of this.nodes) {
      if ((n.type === 'bridge_callback' || n.schema) && n.name) {
        this.bridgeByName.set(n.name, n);
      }
    }

    // Fuzzy search index with strict ranking
    this.fuse = new Fuse(this.nodes, {
      keys: [
        { name: 'name', weight: 2.0 },
        { name: 'id', weight: 1.5 },
        { name: 'relative_path', weight: 1.0 }
      ],
      threshold: 0.3, // Stricter threshold for exactness
      distance: 50,
      includeScore: true,
      useExtendedSearch: true,
    });

    // stdout is reserved exclusively for framed MCP messages in stdio mode.
    console.error(`[graph-index] Loaded: ${this.nodes.length} nodes, ${this.edges.length} edges`);
    console.error(`[graph-index] Functions: ${this.functionsByName.size} unique names`);
    console.error(`[graph-index] Bridges: ${this.bridgeByName.size} schemas`);
  }

  search(query, type = null, module = null, limit = 20) {
    // 1. Try exact matches first
    let exactMatches = this.nodes.filter(n => 
      (n.name && n.name.toLowerCase() === query.toLowerCase()) || 
      (n.id && n.id.toLowerCase().includes(query.toLowerCase()))
    );

    let fuzzyMatches = this.fuse.search(query).map(r => r.item);
    
    // Combine, keeping exact matches first
    let items = [...new Set([...exactMatches, ...fuzzyMatches])];

    if (type) items = items.filter(n => n.type === type);
    if (module) items = items.filter(n => n.classification?.module_name === module);
    
    // 2. Rank source code above assets if there's ambiguity
    items.sort((a, b) => {
      const isSrcA = ['file', 'function', 'js_function', 'bridge_callback'].includes(a.type) ? 1 : 0;
      const isSrcB = ['file', 'function', 'js_function', 'bridge_callback'].includes(b.type) ? 1 : 0;
      return isSrcB - isSrcA;
    });

    return items.slice(0, limit).map(n => ({
      id: n.id,
      type: n.type,
      name: n.name,
      relative_path: n.relative_path,
      line: n.line,
      module: n.classification?.module_name,
      language: n.classification?.language,
      params: n.params,
    }));
  }

  trace(nodeId, depth = 4, direction = 'both') {
    const result = { source: null, upstream: [], downstream: [] };
    const node = this.nodeById.get(nodeId);
    if (!node) return result;

    result.source = this._summarizeNode(node);

    if (direction === 'both' || direction === 'upstream') {
      result.upstream = this._bfs(nodeId, 'upstream', depth);
    }
    if (direction === 'both' || direction === 'downstream') {
      result.downstream = this._bfs(nodeId, 'downstream', depth);
    }

    return result;
  }

  impact(nodeId, depth = 3) {
    const upstream = this._bfs(nodeId, 'upstream', depth);
    const downstream = this._bfs(nodeId, 'downstream', depth);
    const total = upstream.length + downstream.length;
    
    // Calculate unique files affected to avoid M x N explosion of duplicate nodes
    const uniqueFiles = new Set();
    for (const n of upstream) {
      if (
        n.edgeType !== 'contains'
        && ['file', 'function', 'js_function', 'bridge_callback'].includes(n.type)
        && n.file
      ) {
        uniqueFiles.add(String(n.file).replace(/^file:/, ''));
      }
    }
    const upFileCount = uniqueFiles.size;

    let level = 'low', score = 0;
    if (upFileCount >= 10) { level = 'critical'; score = 95; }
    else if (upFileCount >= 5) { level = 'high'; score = 75; }
    else if (upFileCount >= 2) { level = 'medium'; score = 50; }
    else { score = Math.min(20, upFileCount * 15); }

    return { sourceId: nodeId, upstream, downstream, totalAffected: total, uniqueFilesAffected: upFileCount, severity: { score, level } };
  }

  bridge(name) {
    const node = this.bridgeByName.get(name);
    if (!node) return null;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      schema: node.schema || null,
      incoming: (this.incoming.get(node.id) || []).map(e => ({ from: e.from, type: e.type })),
      outgoing: (this.outgoing.get(node.id) || []).map(e => ({ to: e.to, type: e.type })),
    };
  }

  getNode(id) {
    const node = this.nodeById.get(id);
    if (!node) return null;
    return {
      ...this._summarizeNode(node),
      incoming: (this.incoming.get(id) || []).slice(0, 30).map(e => ({ from: e.from, type: e.type })),
      outgoing: (this.outgoing.get(id) || []).slice(0, 30).map(e => ({ to: e.to, type: e.type })),
      functions: (this.functionsByFile.get(id) || []).map(f => ({ name: f.name, line: f.line, params: f.params })),
    };
  }

  readSource(nodeId, contextLines = 5) {
    const node = this.nodeById.get(nodeId);
    if (!node) return null;

    const relPath = node.relative_path || (node.parent_file ? this.nodeById.get(node.parent_file)?.relative_path : null);
    if (!relPath || !this.root) return null;

    try {
      const fullPath = resolveContainedExistingPath(this.root, relPath);
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      if (node.line) {
        const start = Math.max(0, node.line - 1 - contextLines);
        const end = Math.min(lines.length, node.line + contextLines + 20);
        return {
          file: relPath,
          startLine: start + 1,
          endLine: end,
          content: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n'),
        };
      }

      // Return first 50 lines for file nodes
      return {
        file: relPath,
        startLine: 1,
        endLine: Math.min(50, lines.length),
        totalLines: lines.length,
        content: lines.slice(0, 50).map((l, i) => `${i + 1}: ${l}`).join('\n'),
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ── Private helpers ──

  _bfs(sourceId, direction, maxDepth) {
    const visited = new Set([sourceId]);
    const result = [];
    const queue = [];

    const initial = direction === 'upstream'
      ? (this.incoming.get(sourceId) || [])
      : (this.outgoing.get(sourceId) || []);

    for (const e of initial) {
      const nid = direction === 'upstream' ? e.from : e.to;
      if (!visited.has(nid)) { visited.add(nid); queue.push({ id: nid, depth: 1, edgeType: e.type }); }
    }

    while (queue.length > 0) {
      const cur = queue.shift();
      const node = this.nodeById.get(cur.id);
      result.push({
        id: cur.id,
        depth: cur.depth,
        edgeType: cur.edgeType,
        name: node?.name,
        type: node?.type,
        file: node?.relative_path || node?.parent_file,
        line: node?.line,
      });

      if (cur.depth < maxDepth) {
        const edges = direction === 'upstream'
          ? (this.incoming.get(cur.id) || [])
          : (this.outgoing.get(cur.id) || []);
        for (const e of edges) {
          const nid = direction === 'upstream' ? e.from : e.to;
          if (!visited.has(nid)) { visited.add(nid); queue.push({ id: nid, depth: cur.depth + 1, edgeType: e.type }); }
        }
      }
    }
    return result;
  }

  _summarizeNode(n) {
    return {
      id: n.id, type: n.type, name: n.name,
      relative_path: n.relative_path, line: n.line,
      module: n.classification?.module_name,
      language: n.classification?.language,
      params: n.params,
      schema: n.schema,
    };
  }
}
