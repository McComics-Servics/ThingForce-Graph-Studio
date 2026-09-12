import { motion } from 'motion/react';
import { Layers, BarChart3, FolderTree, Network } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useGraphStore } from '../../store/graphStore';
import { MetricsTab } from './MetricsTab';
import { ExplorerTab } from './ExplorerTab';
import { ProjectsTab } from './ProjectsTab';
import { TraceTab } from './TraceTab';

const TABS = [
  { id: 'projects' as const, label: 'Proyectos', icon: Layers },
  { id: 'metrics' as const, label: 'Métricas', icon: BarChart3 },
  { id: 'explorer' as const, label: 'Explorar', icon: FolderTree },
  { id: 'trace' as const, label: 'Trazabilidad', icon: Network },
] as const;

export function Sidebar() {
  const sidebarTab = useGraphStore((s) => s.sidebarTab);
  const setSidebarTab = useGraphStore((s) => s.setSidebarTab);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 449, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
      className="border-r border-border bg-bg-surface flex flex-col flex-shrink-0 relative overflow-hidden"
    >
      {/* Header */}
      <div className="h-14 flex items-center px-4 border-b border-border bg-bg-elevated/50 backdrop-blur-md sticky top-0 z-10">
        <Network className="w-5 h-5 text-brand mr-2.5" />
        <h1 className="font-semibold text-sm tracking-wide text-text-primary">ThingForce™ Studio</h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-bg-surface">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = sidebarTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSidebarTab(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-all border-b-2 -mb-px',
                isActive
                  ? 'border-brand text-brand'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 w-[449px]">
        {sidebarTab === 'projects' && <ProjectsTab />}
        {sidebarTab === 'metrics' && <MetricsTab />}
        {sidebarTab === 'explorer' && <ExplorerTab />}
        {sidebarTab === 'trace' && <TraceTab />}
      </div>
    </motion.div>
  );
}
