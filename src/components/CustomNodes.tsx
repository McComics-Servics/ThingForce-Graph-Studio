import { Handle, Position } from '@xyflow/react';
import { FolderTree, FileCode, Zap, Image, Braces } from 'lucide-react';

export function FileNode({ data }: any) {
  return (
    <div className="bg-bg-surface border border-border shadow-lg rounded-xl overflow-hidden min-w-[250px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-emerald-500 border-2 border-bg-surface" />
      
      <div className="bg-brand/10 px-4 py-2 border-b border-border flex items-center gap-3">
        <FileCode className="w-4 h-4 text-brand" />
        <span className="font-bold text-sm text-text-primary truncate">{data.label}</span>
      </div>
      
      <div className="p-4 flex flex-col gap-2">
        <div className="flex justify-between items-center text-xs">
          <span className="text-text-muted font-medium">Lenguaje:</span>
          <span className="bg-bg-base px-2 py-0.5 rounded border border-border capitalize text-brand font-bold">{data.language || 'N/A'}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-text-muted font-medium">Módulo:</span>
          <span className="bg-bg-base px-2 py-0.5 rounded border border-border text-amber-500 font-bold">{data.module || 'Root'}</span>
        </div>
      </div>
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-brand border-2 border-bg-surface" />
    </div>
  );
}

export function FolderNode({ data }: any) {
  return (
    <div className="bg-bg-base border-2 border-dashed border-amber-500/40 hover:border-amber-500/70 shadow-sm rounded-2xl min-w-[200px] transition-colors">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-amber-500/50 border-2 border-bg-base" />
      
      <div className="px-5 py-4 flex items-center gap-3">
        <FolderTree className="w-6 h-6 text-amber-500" />
        <div className="flex flex-col">
          <span className="font-bold text-sm text-text-primary tracking-wide">{data.label}</span>
          <span className="text-[10px] text-text-muted uppercase tracking-widest mt-0.5">
            {data.childCount ? `${data.childCount} archivos` : 'Directorio'}
          </span>
        </div>
      </div>
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-amber-500/50 border-2 border-bg-base" />
    </div>
  );
}

export function AssetNode({ data }: any) {
  return (
    <div className="bg-bg-surface border border-emerald-500/30 shadow-lg rounded-xl overflow-hidden min-w-[200px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-emerald-500 border-2 border-bg-surface" />
      
      <div className="bg-emerald-500/10 px-4 py-2 border-b border-emerald-500/20 flex items-center gap-3">
        <Image className="w-4 h-4 text-emerald-500" />
        <span className="font-bold text-sm text-text-primary truncate">{data.label}</span>
      </div>
      
      <div className="p-3 flex justify-between items-center text-xs">
        <span className="text-text-muted font-medium">Tipo:</span>
        <span className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded border border-emerald-500/20 font-bold uppercase">{data.language || 'asset'}</span>
      </div>
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-emerald-500 border-2 border-bg-surface" />
    </div>
  );
}

export function ActionNode({ data }: any) {
  return (
    <div className="bg-bg-elevated border border-border shadow-md rounded-full px-5 py-2.5 flex items-center gap-2">
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-text-muted" />
      <Zap className="w-4 h-4 text-amber-500" />
      <span className="font-semibold text-xs text-text-primary">{data.label}</span>
      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-text-muted" />
    </div>
  );
}

export function FunctionNode({ data }: any) {
  return (
    <div className="bg-bg-surface border border-violet-500/30 shadow-lg rounded-xl overflow-hidden min-w-[220px]">
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-violet-500 border-2 border-bg-surface" />
      
      <div className="bg-violet-500/10 px-4 py-2 border-b border-violet-500/20 flex items-center gap-2">
        <Braces className="w-4 h-4 text-violet-500" />
        <span className="font-bold text-sm text-text-primary truncate">{data.label}</span>
        {data.line && (
          <span className="ml-auto text-[10px] text-text-muted font-mono">L{data.line}</span>
        )}
      </div>
      
      {data.params && data.params.length > 0 && (
        <div className="px-4 py-2 text-[10px] text-violet-400 font-mono truncate">
          ({data.params.join(', ')})
        </div>
      )}
      
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-violet-500 border-2 border-bg-surface" />
    </div>
  );
}
