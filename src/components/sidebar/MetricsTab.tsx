import { useGraphStore } from '../../store/graphStore';

export function MetricsTab() {
  const graphData = useGraphStore((s) => s.graphData);
  const summary = graphData?.summary || {};

  return (
    <div className="flex flex-col gap-6">
      {/* Counters */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Resumen</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-base p-3.5 rounded-xl border border-border shadow-sm">
            <div className="text-2xl font-bold tracking-tight text-text-primary">{summary.nodes_total || 0}</div>
            <div className="text-xs text-text-muted font-medium mt-0.5">Total Nodos</div>
          </div>
          <div className="bg-bg-base p-3.5 rounded-xl border border-border shadow-sm">
            <div className="text-2xl font-bold tracking-tight text-text-primary">{summary.edges_total || 0}</div>
            <div className="text-xs text-text-muted font-medium mt-0.5">Relaciones</div>
          </div>
        </div>
      </div>

      {/* Enricher stats */}
      {summary.enricher && (
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Enriquecedor</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-500/5 p-2.5 rounded-lg border border-emerald-500/10 text-center">
              <div className="text-lg font-bold text-emerald-500">{summary.enricher.added_asset_nodes}</div>
              <div className="text-[10px] text-text-muted">Assets</div>
            </div>
            <div className="bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/10 text-center">
              <div className="text-lg font-bold text-amber-500">{summary.enricher.added_folder_nodes}</div>
              <div className="text-[10px] text-text-muted">Carpetas</div>
            </div>
          </div>
        </div>
      )}

      {/* Layers */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Capas</span>
        <div className="flex flex-col gap-1.5">
          {Object.entries(summary.layers || {}).sort((a: any, b: any) => b[1] - a[1]).map(([layer, count]: any) => (
            <div key={layer} className="group flex justify-between items-center text-sm px-2.5 py-2 rounded-lg hover:bg-bg-base transition-all cursor-default text-text-secondary hover:text-text-primary border border-transparent hover:border-border">
              <span className="truncate font-medium">{layer}</span>
              <span className="bg-bg-elevated px-2 py-0.5 rounded-md text-[11px] font-semibold border border-border">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Languages */}
      <div className="flex flex-col gap-3">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Lenguajes</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.languages || {}).sort((a: any, b: any) => b[1] - a[1]).map(([lang, count]: any) => (
            <span key={lang} className="bg-brand/10 text-brand px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider">
              {lang} <span className="text-text-muted font-normal ml-1">{count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
