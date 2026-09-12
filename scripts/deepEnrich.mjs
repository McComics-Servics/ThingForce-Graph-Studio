/**
 * Deep Enricher v2 — Nodos de función, esquemas bridge, y metadata avanzada
 * 
 * Lee graph.json y añade:
 *   1. Nodos de FUNCIÓN (cada def/function dentro de archivos Ruby/JS)
 *   2. Esquemas de BRIDGE (parámetros de add_action_callback)
 *   3. Aristas function→function para llamadas entre funciones
 * 
 * Uso:  node scripts/deepEnrich.mjs <ruta_plugin> <public/.staging/.../graph.json>
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { assertStagingGraphPath } from './staging-policy.mjs';

const pluginRoot = process.argv[2];
const graphPathArgument = process.argv[3];

if (!pluginRoot || !graphPathArgument) {
  console.error('Uso: node scripts/deepEnrich.mjs <ruta_plugin> <public/.staging/.../graph.json>');
  process.exit(1);
}
const graphPath = assertStagingGraphPath(graphPathArgument, import.meta.dirname);

console.log(`[deep-enricher] Plugin root: ${pluginRoot}`);
console.log(`[deep-enricher] Graph path : ${graphPath}`);

const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const existingNodeIds = new Set(graph.nodes.map(n => n.id));
const existingEdgeKeys = new Set(graph.edges.map(e => `${e.from}|${e.to}|${e.type}`));

let addedFunctionNodes = 0;
let addedBridgeSchemas = 0;
let addedCallEdges = 0;

// ── 1. Extraer nodos de FUNCIÓN de archivos Ruby ────────────────────
const RUBY_DEF_REGEX = /^(\s*)def\s+(self\.)?(\w+[?!=]?)\s*(?:\(([^)]*)\))?/gm;
const JS_FUNC_REGEX  = /(?:^|\s)(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*[:=]\s*(?:async\s*)?\(?function)/gm;
const BRIDGE_REGEX   = /add_action_callback\s*\(\s*['"]([\w]+)['"]\s*\)\s*do\s*\|([^|]*)\|/g;

// Map to store all functions per file for cross-reference
const fileFunctions = new Map(); // fileId → [{name, line, params}]
const bridgeSchemas = [];

for (const node of graph.nodes) {
  if (node.type !== 'file') continue;
  const relPath = node.relative_path;
  if (!relPath) continue;

  const ext = extname(relPath).toLowerCase();
  const fullPath = join(pluginRoot, relPath);
  if (!existsSync(fullPath)) continue;

  let content;
  try {
    content = readFileSync(fullPath, 'utf-8');
  } catch { continue; }

  const functions = [];

  // ── Ruby functions ──
  if (ext === '.rb') {
    let match;
    RUBY_DEF_REGEX.lastIndex = 0;
    while ((match = RUBY_DEF_REGEX.exec(content)) !== null) {
      const indent = match[1].length;
      const isSelf = !!match[2];
      const name = match[3];
      const params = match[4] ? match[4].split(',').map(p => p.trim()).filter(Boolean) : [];
      const line = content.substring(0, match.index).split('\n').length;

      // Find the end of the method (next def at same or lesser indent, or end)
      const afterDef = content.substring(match.index + match[0].length);
      const endPattern = new RegExp(`^\\s{0,${indent}}(def |end\\b|class |module )`, 'm');
      const endMatch = endPattern.exec(afterDef);
      const bodyLength = endMatch ? endMatch.index : Math.min(afterDef.length, 500);
      const body = afterDef.substring(0, bodyLength);

      // Extract function calls within this method body
      const calls = [];
      const callMatches = body.matchAll(/\b([a-z_]\w*[?!]?)\s*(?:\(|$)/gm);
      const RUBY_KEYWORDS = new Set(['if', 'else', 'elsif', 'end', 'do', 'begin', 'rescue', 'ensure', 'return', 'yield', 'raise', 'puts', 'print', 'require', 'require_relative', 'include', 'extend', 'attr_reader', 'attr_writer', 'attr_accessor', 'when', 'case', 'unless', 'until', 'while', 'for', 'break', 'next', 'super', 'self', 'nil', 'true', 'false', 'and', 'or', 'not', 'in', 'then', 'defined']);
      for (const cm of callMatches) {
        if (!RUBY_KEYWORDS.has(cm[1]) && cm[1] !== name) {
          calls.push(cm[1]);
        }
      }

      functions.push({
        name,
        line,
        params,
        isSelf,
        visibility: indent <= 4 ? 'public' : 'private',
        calls: [...new Set(calls)].slice(0, 30),
      });
    }

    // ── Bridge schemas ──
    BRIDGE_REGEX.lastIndex = 0;
    while ((match = BRIDGE_REGEX.exec(content)) !== null) {
      const callbackName = match[1];
      const blockParams = match[2].split(',').map(p => p.trim()).filter(Boolean);
      const line = content.substring(0, match.index).split('\n').length;

      // Try to extract JSON.parse or payload keys from the block body
      const afterBlock = content.substring(match.index + match[0].length);
      const blockEnd = afterBlock.indexOf('\n        end');
      const blockBody = afterBlock.substring(0, blockEnd > 0 ? Math.min(blockEnd, 2000) : 500);

      // Find payload keys accessed
      const payloadKeys = [];
      for (const km of blockBody.matchAll(/\[['"](\w+)['"]\]/g)) {
        payloadKeys.push(km[1]);
      }
      // Also find payload.dig, payload['key'], data['key'] patterns
      for (const km of blockBody.matchAll(/(?:payload|data|params|raw)\s*(?:\[['"](\w+)['"]\]|\.dig\(['"](\w+)['"])/g)) {
        payloadKeys.push(km[1] || km[2]);
      }

      // Extract function calls inside bridge callback block
      const calls = [];
      const callMatches = blockBody.matchAll(/(?:@\w+\.)?\b([a-z_]\w*[?!]?)\s*(?:\(|$)/gm);
      const RUBY_KEYWORDS = new Set(['if', 'else', 'elsif', 'end', 'do', 'begin', 'rescue', 'ensure', 'return', 'yield', 'raise', 'puts', 'print', 'require', 'require_relative', 'include', 'extend', 'when', 'case', 'unless', 'until', 'while', 'for', 'break', 'next', 'super', 'self', 'nil', 'true', 'false', 'and', 'or', 'not', 'in', 'then', 'defined']);
      for (const cm of callMatches) {
        if (!RUBY_KEYWORDS.has(cm[1])) calls.push(cm[1]);
      }

      bridgeSchemas.push({
        name: callbackName,
        file: relPath,
        line,
        blockParams,
        payloadKeys: [...new Set(payloadKeys)],
        calls: [...new Set(calls)].slice(0, 30),
      });
      addedBridgeSchemas++;
    }
  }

  // ── JS/TS functions ──
  if (['.js', '.ts', '.tsx'].includes(ext)) {
    let match;
    JS_FUNC_REGEX.lastIndex = 0;
    while ((match = JS_FUNC_REGEX.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      if (!name) continue;
      const line = content.substring(0, match.index).split('\n').length;
      functions.push({
        name,
        line,
        params: [],
        isSelf: false,
        visibility: 'public',
        calls: [],
      });
    }
  }

  // ── Data Flow Nodes (Ruby only) ──
  if (ext === '.rb') {
    const DATA_REGEX = /\b(?:set_attribute|get_attribute)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    let dataMatch;
    while ((dataMatch = DATA_REGEX.exec(content)) !== null) {
      const action = dataMatch[0].includes('set_attribute') ? 'set_attribute' : 'get_attribute';
      const dict = dataMatch[1];
      const key = dataMatch[2];
      const dataNodeId = 'data:' + dict + ':' + key;
      if (!existingNodeIds.has(dataNodeId)) {
        graph.nodes.push({
          id: dataNodeId,
          type: 'data_flow',
          name: key,
          dictionary: dict,
          classification: { language: 'data', extension: '', layer: 'data', module_name: dict, labels: ['data_flow_node'] },
        });
        existingNodeIds.add(dataNodeId);
      }
      const line = content.substring(0, dataMatch.index).split('\n').length;
      graph.edges.push({ from: node.id, to: dataNodeId, type: action === 'set_attribute' ? 'writes_data' : 'reads_data', line: line, tempType: 'data' });
    }
  }

  if (functions.length > 0) {
    fileFunctions.set(node.id, functions);
  }
}

// ── 2. Crear nodos de función y aristas file→function ────────────────
for (const [fileId, functions] of fileFunctions) {
  for (const func of functions) {
    const funcId = `fn:${fileId.replace('file:', '')}::${func.name}`;
    if (existingNodeIds.has(funcId)) continue;

    graph.nodes.push({
      id: funcId,
      type: 'function',
      name: func.name,
      parent_file: fileId,
      line: func.line,
      params: func.params,
      visibility: func.visibility,
      calls: func.calls,
      classification: {
        language: 'function',
        extension: '',
        layer: 'code_unit',
        module_name: null,
        labels: ['function', func.visibility],
      },
    });
    existingNodeIds.add(funcId);
    addedFunctionNodes++;

    // Edge: file → defines_function → function
    const edgeKey = `${fileId}|${funcId}|defines_function`;
    if (!existingEdgeKeys.has(edgeKey)) {
      graph.edges.push({ from: fileId, to: funcId, type: 'defines_function' });
      existingEdgeKeys.add(edgeKey);
    }
  }
}

// ── 3. Crear aristas function→function (llamadas entre funciones) ───
// Build a global function name → funcId map
const funcNameIndex = new Map(); // name → [funcId, ...]
for (const [fileId, functions] of fileFunctions) {
  for (const func of functions) {
    const funcId = `fn:${fileId.replace('file:', '')}::${func.name}`;
    const existing = funcNameIndex.get(func.name) || [];
    existing.push(funcId);
    funcNameIndex.set(func.name, existing);
  }
}

// Now resolve calls
for (const [fileId, functions] of fileFunctions) {
  for (const func of functions) {
    const callerFuncId = `fn:${fileId.replace('file:', '')}::${func.name}`;
    const fileRelPath = fileId.replace('file:', '');

    for (const callName of func.calls) {
      // First try same-file functions
      const sameFuncId = `fn:${fileRelPath}::${callName}`;
      if (existingNodeIds.has(sameFuncId) && sameFuncId !== callerFuncId) {
        const edgeKey = `${callerFuncId}|${sameFuncId}|calls_function`;
        if (!existingEdgeKeys.has(edgeKey)) {
          graph.edges.push({ from: callerFuncId, to: sameFuncId, type: 'calls_function' });
          existingEdgeKeys.add(edgeKey);
          addedCallEdges++;
        }
      }
    }
  }
}

// ── 4. Añadir bridge schemas como metadata en nodos bridge existentes ─
for (const schema of bridgeSchemas) {
  const bridgeNodeId = `bridge:${schema.name}`;
  const existingNode = graph.nodes.find(n => n.id === bridgeNodeId);
  if (existingNode) {
    existingNode.schema = {
      defined_in: schema.file,
      line: schema.line,
      block_params: schema.blockParams,
      payload_keys: schema.payloadKeys,
    };
  } else {
    // Create bridge node with schema if it doesn't exist
    graph.nodes.push({
      id: bridgeNodeId,
      type: 'bridge_callback',
      name: schema.name,
      schema: {
        defined_in: schema.file,
        line: schema.line,
        block_params: schema.blockParams,
        payload_keys: schema.payloadKeys,
      },
      classification: {
        language: 'bridge',
        extension: '',
        layer: 'bridge',
        module_name: null,
        labels: ['bridge_callback', 'has_schema'],
      },
    });
    existingNodeIds.add(bridgeNodeId);
  }

  // Resolve downstream calls from bridge callbacks
  if (schema.calls && schema.calls.length > 0) {
    for (const callName of schema.calls) {
      // Find matching function nodes
      const possibleTargets = funcNameIndex.get(callName) || [];
      if (possibleTargets.length > 0 && possibleTargets.length <= 15) {
        for (const targetFuncId of possibleTargets) {
          const edgeKey = bridgeNodeId + '|' + targetFuncId + '|calls_function';
          if (!existingEdgeKeys.has(edgeKey)) {
            graph.edges.push({ from: bridgeNodeId, to: targetFuncId, type: 'calls_function' });
            existingEdgeKeys.add(edgeKey);
            addedCallEdges++;
          }
        }
      }
    }
  }
}

// ── 5. Actualizar summary ────────────────────────────────────────────

// Process data edges
let addedDataEdges = 0;
for (let i = 0; i < graph.edges.length; i++) {
  const e = graph.edges[i];
  if (e.tempType === 'data') {
    delete e.tempType;
    const fileId = e.from;
    const funcs = fileFunctions.get(fileId) || [];
    let parentFunc = null;
    for (const f of funcs) {
      if (f.line <= e.line) parentFunc = 'fn:' + fileId.replace('file:', '') + '::' + f.name;
    }
    const sourceNodeId = parentFunc || fileId;
    
    if (e.type === 'writes_data') {
      e.from = sourceNodeId;
    } else {
      e.from = e.to;
      e.to = sourceNodeId;
    }
    const edgeKey = e.from + '|' + e.to + '|' + e.type;
    if (existingEdgeKeys.has(edgeKey)) {
      e.deleteMe = true;
    } else {
      existingEdgeKeys.add(edgeKey);
      addedDataEdges++;
    }
  }
}
graph.edges = graph.edges.filter(e => !e.deleteMe);

graph.summary.nodes_total = graph.nodes.length;
graph.summary.edges_total = graph.edges.length;
graph.summary.deep_enricher = {
  ran_at: new Date().toISOString(),
  function_nodes_added: addedFunctionNodes,
  bridge_schemas_captured: addedBridgeSchemas,
  call_edges_added: addedCallEdges,
  data_edges_added: addedDataEdges,
  total_functions: [...fileFunctions.values()].reduce((a, b) => a + b.length, 0),
};

// ── 6. Escribir grafo ────────────────────────────────────────────────
writeFileSync(graphPath, JSON.stringify(graph));

console.log(`[deep-enricher] ✓ Function nodes added : ${addedFunctionNodes}`);
console.log(`[deep-enricher] ✓ Bridge schemas found : ${addedBridgeSchemas}`);
console.log(`[deep-enricher] ✓ Call edges added      : ${addedCallEdges}`);
console.log(`[deep-enricher] ✓ Total nodes: ${graph.nodes.length}, Total edges: ${graph.edges.length}`);
console.log(`[deep-enricher] ✓ Written to: ${graphPath}`);
