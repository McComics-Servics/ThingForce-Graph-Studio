import { useMemo } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, Zap, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useGraphStore } from '../../store/graphStore';
import { analyzeImpact, impactSeverity } from '../../lib/impactAnalysis';
import { cn } from '../../lib/utils';

export function ImpactPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const index = useGraphStore((s) => s.index);
  const selectNode = useGraphStore((s) => s.selectNode);

  const result = useMemo(() => {
    if (!selectedNodeId || !index) return null;
    return analyzeImpact(selectedNodeId, index, 3);
  }, [selectedNodeId, index]);

  if (!result) return null;

  const severity = impactSeverity(result, index!);

  const SeverityIcon = severity.level === 'critical' ? ShieldAlert
    : severity.level === 'high' ? AlertTriangle
    : severity.level === 'medium' ? Shield
    : ShieldCheck;

  const severityColor = severity.level === 'critical' ? 'text-red-500'
    : severity.level === 'high' ? 'text-orange-500'
    : severity.level === 'medium' ? 'text-amber-500'
    : 'text-emerald-500';

  const severityBg = severity.level === 'critical' ? 'bg-red-500/10 border-red-500/20'
    : severity.level === 'high' ? 'bg-orange-500/10 border-orange-500/20'
    : severity.level === 'medium' ? 'bg-amber-500/10 border-amber-500/20'
    : 'bg-emerald-500/10 border-emerald-500/20';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-bg-surface border border-border rounded-2xl p-6 shadow-sm"
    >
      <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-4 flex items-center gap-2">
        <Zap className="w-4 h-4 text-brand" />
        Análisis de Impacto BFS
      </h3>

      {/* Severity Badge */}
      <div className={cn('flex items-center gap-3 p-4 rounded-xl border mb-5', severityBg)}>
        <SeverityIcon className={cn('w-8 h-8', severityColor)} />
        <div>
          <div className="flex items-center gap-2">
            <span className={cn('text-lg font-bold', severityColor)}>{severity.score}/100</span>
            <span className={cn('text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full', severityBg, severityColor)}>
              {severity.level}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">{severity.reason}</p>
        </div>
      </div>

      {/* Impact Counts */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-bg-base p-3 rounded-xl border border-border text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs font-bold text-text-muted uppercase">Upstream</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">{result.upstream.length}</div>
          <div className="text-[10px] text-text-muted">dependen de este</div>
        </div>
        <div className="bg-bg-base p-3 rounded-xl border border-border text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <ArrowDownRight className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs font-bold text-text-muted uppercase">Downstream</span>
          </div>
          <div className="text-2xl font-bold text-text-primary">{result.downstream.length}</div>
          <div className="text-[10px] text-text-muted">este depende de</div>
        </div>
      </div>

      {/* Upstream list (most dangerous) */}
      {result.upstream.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">
            ⚠ Si cambias este archivo, se afectan:
          </h4>
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {result.upstream.slice(0, 30).map((impact, i) => (
              <button
                key={i}
                onClick={() => selectNode(impact.id)}
                className="text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-base transition-colors text-xs group"
              >
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/10 text-red-400 text-[10px] font-bold flex-shrink-0">
                  {impact.depth}
                </span>
                <span className="truncate text-text-secondary group-hover:text-text-primary flex-1">
                  {impact.id.replace('file:', '').replace('folder:', '').replace(/^fn:/, '⨍ ')}
                </span>
                <span className="text-[9px] text-text-muted font-mono">{impact.edgeType}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Downstream list */}
      {result.downstream.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-2">
            Este archivo depende de:
          </h4>
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {result.downstream.slice(0, 30).map((impact, i) => (
              <button
                key={i}
                onClick={() => selectNode(impact.id)}
                className="text-left flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-bg-base transition-colors text-xs group"
              >
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold flex-shrink-0">
                  {impact.depth}
                </span>
                <span className="truncate text-text-secondary group-hover:text-text-primary flex-1">
                  {impact.id.replace('file:', '').replace('folder:', '').replace(/^fn:/, '⨍ ')}
                </span>
                <span className="text-[9px] text-text-muted font-mono">{impact.edgeType}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
