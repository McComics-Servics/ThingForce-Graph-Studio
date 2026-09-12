import { useEffect, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  Panel,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FileNode, FolderNode, ActionNode, AssetNode, FunctionNode } from './CustomNodes';
import { buildVisualGraph } from '../lib/graphTransform';
import { useGraphStore } from '../store/graphStore';

const nodeTypes = { file: FileNode, folder: FolderNode, action: ActionNode, asset: AssetNode, function: FunctionNode };

export function VisualGraphEngine({
  graphData,
  focusNodeId,
}: {
  graphData: any;
  focusNodeId: string | null;
}) {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);

  const index = useGraphStore((s) => s.index);

  useEffect(() => {
    if (graphData && focusNodeId) {
      const result = buildVisualGraph(graphData, focusNodeId, index);
      setNodes(result.nodes);
      setEdges(result.edges);
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [graphData, focusNodeId, index]);

  const onNodesChange = (changes: NodeChange[]) =>
    setNodes((prev) => applyNodeChanges(changes, prev));
  const onEdgesChange = (changes: EdgeChange[]) =>
    setEdges((prev) => applyEdgeChanges(changes, prev));

  if (!focusNodeId) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted/50 border border-dashed border-border/50 rounded-2xl text-sm">
        Selecciona un nodo del buscador para iniciar el motor visual
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden border border-border shadow-inner bg-bg-base/50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" gap={24} size={2} />
        <Controls />
        <MiniMap
          nodeColor={(node: any) => {
            if (node.type === 'function') return '#8b5cf6';
            if (node.type === 'file') return '#3b82f6';
            if (node.type === 'asset') return '#10b981';
            if (node.type === 'folder') return '#f59e0b';
            if (node.type === 'action') return '#f59e0b';
            return '#6b7280';
          }}
          style={{ backgroundColor: '#1a1a2e' }}
        />
        <Panel position="top-right">
          <div className="bg-bg-elevated/80 backdrop-blur-sm border border-border p-3 rounded-xl shadow-lg">
            <div className="text-xs font-bold uppercase tracking-widest text-text-secondary">
              Vista Estructural
            </div>
            <div className="text-xs text-text-muted mt-1">
              Explorando {nodes.length} nodos
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
