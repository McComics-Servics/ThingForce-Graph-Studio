/**
 * GraphIndex — Pre-built O(1) lookup tables.
 * Replaces all Array.find() and Array.filter() with Map lookups.
 */

export interface GraphIndex {
  nodeById: Map<string, any>;
  incomingEdges: Map<string, any[]>;
  outgoingEdges: Map<string, any[]>;
  nodeCount: number;
  edgeCount: number;
}

export function buildGraphIndex(graphData: any): GraphIndex {
  const nodes: any[] = graphData?.nodes || [];
  const edges: any[] = graphData?.edges || [];

  const nodeById = new Map<string, any>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
  }

  const incomingEdges = new Map<string, any[]>();
  const outgoingEdges = new Map<string, any[]>();

  for (const edge of edges) {
    // Outgoing: from → [edges]
    const out = outgoingEdges.get(edge.from);
    if (out) out.push(edge);
    else outgoingEdges.set(edge.from, [edge]);

    // Incoming: to → [edges]
    const inc = incomingEdges.get(edge.to);
    if (inc) inc.push(edge);
    else incomingEdges.set(edge.to, [edge]);
  }

  return {
    nodeById,
    incomingEdges,
    outgoingEdges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}
