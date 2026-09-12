import { useState, useMemo } from 'react';
import { FolderTree, FileCode, Image, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import { openInOS, openFolderInOS } from '../../lib/fileOpener';
import { cn } from '../../lib/utils';

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  nodeId?: string;
  type?: string;
  language?: string;
}

function buildTree(nodes: any[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', isFolder: true, children: [] };

  for (const node of nodes) {
    const relPath = node.relative_path || node.id?.replace('file:', '').replace('folder:', '');
    if (!relPath) continue;

    const parts = relPath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const existingChild = current.children.find((c) => c.name === part);

      if (existingChild) {
        current = existingChild;
        if (isLast && node.type !== 'folder') {
          current.nodeId = node.id;
          current.type = node.type;
          current.language = node.classification?.language;
        }
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isFolder: !isLast || node.type === 'folder',
          children: [],
          nodeId: isLast ? node.id : undefined,
          type: isLast ? node.type : undefined,
          language: isLast ? node.classification?.language : undefined,
        };
        current.children.push(newNode);
        current = newNode;
      }
    }
  }

  // Sort: folders first, then alphabetically
  function sortTree(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortTree);
  }
  sortTree(root);

  return root;
}

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const selectNode = useGraphStore((s) => s.selectNode);

  const handleClick = () => {
    if (node.isFolder) {
      setOpen(!open);
    } else if (node.nodeId) {
      selectNode(node.nodeId);
    }
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isFolder) {
      openFolderInOS(node.path);
    } else {
      openInOS(node.path);
    }
  };

  const Icon = node.isFolder ? FolderTree : node.type === 'asset' ? Image : FileCode;
  const iconColor = node.isFolder ? 'text-amber-500' : node.type === 'asset' ? 'text-emerald-500' : 'text-brand';

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        className={cn(
          'group w-full flex items-center gap-1.5 py-1 px-1.5 rounded-md hover:bg-bg-base transition-colors text-left cursor-pointer',
          depth === 0 && 'font-medium'
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {node.isFolder && (
          open ? <ChevronDown className="w-3 h-3 text-text-muted flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
        )}
        {!node.isFolder && <span className="w-3 flex-shrink-0" />}
        <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', iconColor)} />
        <span className="text-xs text-text-secondary group-hover:text-text-primary truncate flex-1">{node.name}</span>
        <span
          role="button"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') handleOpen(e as any); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-bg-elevated rounded transition-all flex-shrink-0 cursor-pointer"
          title="Abrir en explorador"
        >
          <ExternalLink className="w-3 h-3 text-text-muted" />
        </span>
      </div>
      {node.isFolder && open && node.children.map((child) => (
        <TreeItem key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ExplorerTab() {
  const graphData = useGraphStore((s) => s.graphData);

  const tree = useMemo(() => {
    if (!graphData?.nodes) return null;
    // Only include file and asset nodes for the tree, skip synthetic nodes
    const fileNodes = graphData.nodes.filter((n: any) =>
      n.type === 'file' || n.type === 'asset' || n.type === 'folder'
    );
    return buildTree(fileNodes);
  }, [graphData?.nodes]);

  if (!tree) return <div className="text-text-muted text-sm">Cargando...</div>;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Árbol del Proyecto</span>
      {tree.children.map((child) => (
        <TreeItem key={child.path} node={child} />
      ))}
    </div>
  );
}
