import dagre from 'dagre';
import type { GraphIndex } from './graphIndex';

interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  sourcePosition?: string;
  targetPosition?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  style?: Record<string, any>;
}

/**
 * Build visual graph using O(1) index lookups.
 * Supports: file, folder, asset, function, action nodes.
 */
export function buildVisualGraph(
  graphData: any,
  focusNodeId: string,
  index?: GraphIndex | null,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!graphData || !focusNodeId) return { nodes: [], edges: [] };

  // Use index if available, otherwise fallback to raw arrays
  const nodeById = index?.nodeById;
  const focusNode = nodeById
    ? nodeById.get(focusNodeId)
    : (graphData.nodes || []).find((n: any) => n.id === focusNodeId);

  if (!focusNode) return { nodes: [], edges: [] };

  const newNodes: GraphNode[] = [];
  const newEdges: GraphEdge[] = [];
  const addedNodeIds = new Set<string>();
  const addedEdgeIds = new Set<string>();

  function resolveNodeType(n: any): { type: string; label: string } {
    let type = 'file';
    let label = (n.id || '').replace('file:', '').replace('folder:', '').replace(/^fn:/, '');

    if (n.type === 'function') {
      type = 'function';
      label = n.name || label;
    } else if (n.type === 'bridge_callback' || n.type === 'js_function') {
      type = 'action';
      label = n.name || label;
    } else if (n.type === 'package_dependency' || n.type === 'runtime_module') {
      type = 'action';
      label = n.name || label;
    } else if (n.type === 'folder') {
      type = 'folder';
      label = n.name || label;
    } else if (n.type === 'asset') {
      type = 'asset';
    }

    return { type, label };
  }

  function pushNode(n: any) {
    if (addedNodeIds.has(n.id)) return;
    addedNodeIds.add(n.id);

    const { type, label } = resolveNodeType(n);

    newNodes.push({
      id: n.id,
      type,
      position: { x: 0, y: 0 },
      data: {
        label,
        language: n.classification?.language,
        module: n.classification?.module_name,
        childCount: n.child_count,
        line: n.line,
        params: n.params,
      },
    });
  }

  function pushEdge(from: string, to: string, typeName: string) {
    const edgeId = `${from}__${to}`;
    if (addedEdgeIds.has(edgeId)) return;
    addedEdgeIds.add(edgeId);

    const color = typeName.includes('function') || typeName.includes('calls')
      ? '#8b5cf6'
      : typeName.includes('asset')
      ? '#10b981'
      : typeName.includes('contains')
      ? '#f59e0b'
      : '#3b82f6';

    newEdges.push({
      id: edgeId,
      source: from,
      target: to,
      label: typeName,
      animated: typeName !== 'contains',
      style: { stroke: color, strokeWidth: 2 },
    });
  }

  // 1. Centre node
  pushNode(focusNode);

  // 2. Incoming edges (who depends on me) — O(1) lookup, cap at 20
  const incoming = index
    ? (index.incomingEdges.get(focusNodeId) || [])
    : (graphData.edges || []).filter((e: any) => e.to === focusNodeId);

  for (const e of incoming.slice(0, 20)) {
    const src = nodeById ? nodeById.get(e.from) : (graphData.nodes || []).find((n: any) => n.id === e.from);
    if (src) {
      pushNode(src);
      pushEdge(e.from, e.to, e.type);
    }
  }

  // 3. Outgoing edges (what I depend on) — O(1) lookup, cap at 20
  const outgoing = index
    ? (index.outgoingEdges.get(focusNodeId) || [])
    : (graphData.edges || []).filter((e: any) => e.from === focusNodeId);

  for (const e of outgoing.slice(0, 20)) {
    const tgt = nodeById ? nodeById.get(e.to) : (graphData.nodes || []).find((n: any) => n.id === e.to);
    if (tgt) {
      pushNode(tgt);
      pushEdge(e.from, e.to, e.type);
    }
  }

  // 4. Auto-layout via Dagre
  return layoutWithDagre(newNodes, newEdges);
}

function layoutWithDagre(
  nodes: GraphNode[],
  edges: GraphEdge[],
  direction = 'LR'
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 100, ranksep: 250 });

  const isHorizontal = direction === 'LR';

  for (const node of nodes) {
    const h = node.type === 'function' ? 80 : node.type === 'action' ? 60 : 120;
    g.setNode(node.id, { width: 300, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    node.position = { x: pos.x - 150, y: pos.y - 60 };
    node.targetPosition = isHorizontal ? 'left' : 'top';
    node.sourcePosition = isHorizontal ? 'right' : 'bottom';
  }

  return { nodes, edges };
}
