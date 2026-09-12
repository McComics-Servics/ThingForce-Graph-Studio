/**
 * Impact Analysis — BFS/DFS traversal to find all affected nodes
 * when a given node changes.
 * 
 * "If I change file X, what else could break?"
 */

import type { GraphIndex } from './graphIndex';

export interface ImpactNode {
  id: string;
  depth: number;          // Hops from source
  direction: 'upstream' | 'downstream' | 'source';
  edgeType: string;       // The edge type that connects to this node
  path: string[];         // Full path from source
}

export interface ImpactResult {
  sourceId: string;
  upstream: ImpactNode[];     // Things that depend ON the source (incoming → source)
  downstream: ImpactNode[];   // Things that the source depends on (source → outgoing)
  totalAffected: number;
}

/**
 * Run BFS impact analysis from a source node.
 * @param sourceId - The node that changed
 * @param index - The graph index with O(1) lookups
 * @param maxDepth - Maximum hops to traverse (default 3)
 * @returns ImpactResult with upstream and downstream affected nodes
 */
export function analyzeImpact(
  sourceId: string,
  index: GraphIndex,
  maxDepth: number = 3,
): ImpactResult {
  const upstream = bfs(sourceId, index, 'upstream', maxDepth);
  const downstream = bfs(sourceId, index, 'downstream', maxDepth);

  return {
    sourceId,
    upstream,
    downstream,
    totalAffected: upstream.length + downstream.length,
  };
}

function bfs(
  sourceId: string,
  index: GraphIndex,
  direction: 'upstream' | 'downstream',
  maxDepth: number,
): ImpactNode[] {
  const visited = new Set<string>([sourceId]);
  const result: ImpactNode[] = [];
  const queue: Array<{ id: string; depth: number; edgeType: string; path: string[] }> = [];

  // Seed the queue
  const initialEdges = direction === 'upstream'
    ? (index.incomingEdges.get(sourceId) || [])   // Who depends on me?
    : (index.outgoingEdges.get(sourceId) || []);   // What do I depend on?

  for (const edge of initialEdges) {
    const neighborId = direction === 'upstream' ? edge.from : edge.to;
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push({ id: neighborId, depth: 1, edgeType: edge.type, path: [sourceId, neighborId] });
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    result.push({
      id: current.id,
      depth: current.depth,
      direction,
      edgeType: current.edgeType,
      path: current.path,
    });

    if (current.depth < maxDepth) {
      const nextEdges = direction === 'upstream'
        ? (index.incomingEdges.get(current.id) || [])
        : (index.outgoingEdges.get(current.id) || []);

      for (const edge of nextEdges) {
        const neighborId = direction === 'upstream' ? edge.from : edge.to;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({
            id: neighborId,
            depth: current.depth + 1,
            edgeType: edge.type,
            path: [...current.path, neighborId],
          });
        }
      }
    }
  }

  return result;
}

/**
 * Get a severity score for the impact (0-100).
 * Higher = more dangerous to change.
 */
export function impactSeverity(result: ImpactResult, index: GraphIndex): {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
} {
  const upstreamFiles = new Set<string>();
  for (const impact of result.upstream) {
    const node = index.nodeById.get(impact.id);
    if (
      impact.edgeType !== 'contains'
      && ['file', 'function', 'js_function', 'bridge_callback'].includes(node?.type)
    ) {
      const file = node?.relative_path || node?.parent_file;
      if (file) upstreamFiles.add(String(file).replace(/^file:/, ''));
    }
  }
  const count = upstreamFiles.size;

  if (count >= 10) return { score: 95, level: 'critical', reason: `${count} archivos dependen de este` };
  if (count >= 5) return { score: 75, level: 'high', reason: `${count} archivos dependen de este` };
  if (count >= 2) return { score: 50, level: 'medium', reason: `${count} archivos dependen de este` };
  return {
    score: Math.min(20, count * 15),
    level: 'low',
    reason: count === 0 ? 'Sin archivos dependientes' : 'Solo 1 archivo depende de este',
  };
}
