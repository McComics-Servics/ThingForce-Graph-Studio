import { motion } from 'motion/react';
import { FileCode, FolderTree, Image, Zap, ExternalLink, Braces } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import { openInOS, openFolderInOS } from '../../lib/fileOpener';
import { ImpactPanel } from './ImpactPanel';

export function NodeDetail() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const index = useGraphStore((s) => s.index);
  const selectNode = useGraphStore((s) => s.selectNode);

  if (!selectedNodeId || !index) return null;

  const node = index.nodeById.get(selectedNodeId);
  if (!node) return null;

  const incomingEdges = index.incomingEdges.get(selectedNodeId) || [];
  const outgoingEdges = index.outgoingEdges.get(selectedNodeId) || [];
  const relPath = (node.relative_path || node.id || '').replace('file:', '').replace('folder:', '');

  const handleOpen = () => {
    if (node.type === 'folder') openFolderInOS(relPath);
    else openInOS(relPath);
  };

  const NodeIcon = node.type === 'folder' ? FolderTree : node.type === 'asset' ? Image : node.type === 'function' ? Braces : node.type === 'bridge_callback' || node.type === 'js_function' ? Zap : FileCode;
  const iconColor = node.type === 'folder' ? 'text-amber-500' : node.type === 'asset' ? 'text-emerald-500' : node.type === 'function' ? 'text-violet-500' : 'text-brand';

  return (
    <motion.div
      key={selectedNodeId}
      initial={{ opacity: 0, y: 15, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
      className="max-w-5xl mx-auto flex flex-col gap-6 relative z-10"
    >
      {/* Header */}
      <div className="bg-bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl mt-1 ${node.type === 'asset' ? 'bg-emerald-500/10 border border-emerald-500/20' : node.type === 'folder' ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-brand/10 border border-brand/20'}`}>
            <NodeIcon className={`w-7 h-7 ${iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight break-all text-text-primary leading-tight">
              {relPath}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
              <span className="bg-bg-elevated px-2.5 py-1 rounded-md border border-border font-medium text-text-secondary uppercase tracking-widest">
                {(node.type || '').replace('_', ' ')}
              </span>
              {node.classification?.language && (
                <span className="bg-brand/10 text-brand px-2.5 py-1 rounded-md font-bold uppercase tracking-widest">
                  {node.classification.language}
                </span>
              )}
              {node.classification?.module_name && (
                <span className="bg-amber-500/10 text-amber-500 px-2.5 py-1 rounded-md font-bold uppercase tracking-widest">
                  {node.classification.module_name}
                </span>
              )}
              <button
                onClick={handleOpen}
                className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md bg-bg-elevated border border-border hover:border-brand/50 hover:text-brand transition-colors text-text-muted"
                title="Abrir en explorador de archivos"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="font-medium">Abrir</span>
              </button>
            </div>
          </div>
        </div>

        {/* Relations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 pt-8 border-t border-border/50">
          <RelationList
            title="Depende de"
            count={outgoingEdges.length}
            edges={outgoingEdges}
            getTarget={(e) => e.to}
            color="brand"
            onSelect={selectNode}
          />
          <RelationList
            title="Usado por"
            count={incomingEdges.length}
            edges={incomingEdges}
            getTarget={(e) => e.from}
            color="emerald-500"
            onSelect={selectNode}
          />
        </div>
      </div>

      {/* Bridge Schema (if available) */}
      {node.schema && (
        <div className="bg-bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">Esquema Bridge</h3>
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Definido en:</span>
              <span className="text-brand font-mono">{node.schema.defined_in}:{node.schema.line}</span>
            </div>
            {node.schema.payload_keys?.length > 0 && (
              <div>
                <span className="text-text-muted">Payload keys:</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {node.schema.payload_keys.map((k: string) => (
                    <span key={k} className="bg-violet-500/10 text-violet-400 px-2 py-0.5 rounded font-mono text-[10px]">{k}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Impact Analysis */}
      <ImpactPanel />
    </motion.div>
  );
}

function RelationList({ title, count, edges, getTarget, color, onSelect }: {
  title: string; count: number; edges: any[]; getTarget: (e: any) => string; color: string; onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-bold text-text-secondary flex items-center gap-2 uppercase tracking-widest">
        <div className={`w-2 h-2 rounded-full bg-${color}`} />
        {title} <span className="text-text-muted font-normal ml-auto">{count}</span>
      </h3>
      <div className="bg-bg-base border border-border rounded-xl p-2 max-h-[350px] overflow-y-auto">
        {count === 0 ? (
          <div className="p-6 text-sm text-text-muted text-center">Ninguno</div>
        ) : (
          <div className="flex flex-col gap-1">
            {edges.map((edge: any, i: number) => (
              <button
                key={i}
                onClick={() => onSelect(getTarget(edge))}
                className="group text-left flex flex-col px-3 py-2.5 rounded-lg hover:bg-bg-elevated transition-colors border border-transparent hover:border-border/50 text-text-secondary hover:text-text-primary"
              >
                <span className={`text-[10px] font-bold tracking-widest text-${color}/70 uppercase mb-0.5`}>{edge.type}</span>
                <span className="text-sm truncate w-full">{getTarget(edge).replace('file:', '').replace('folder:', '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
