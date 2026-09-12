import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Activity, FileCode, Clock, Download } from 'lucide-react';
import { cn } from '../../lib/utils';

interface TraceEvent {
  id: string;
  timestamp: number;
  file: string;
  line: number;
  method: string;
  klass: string;
  duration?: number;
}

export function TraceTab() {
  const [isRecording, setIsRecording] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const isRecordingRef = useRef(isRecording);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    // Escuchar eventos de Vite HMR websocket custom
    if (import.meta.hot) {
      const handleTrace = (data: any) => {
        if (!isRecordingRef.current) return;
        setEvents((prev) => {
          // Mantener solo los últimos 500 eventos para no saturar memoria
          const next = [data, ...prev];
          if (next.length > 500) next.length = 500;
          return next;
        });
      };
      
      import.meta.hot.on('mccomics:trace', handleTrace);
      
      return () => {
        if (import.meta.hot?.off) {
          import.meta.hot.off('mccomics:trace', handleTrace);
        }
      };
    }
  }, []);

  const clearTrace = () => setEvents([]);

  const downloadTraceLog = () => {
    if (events.length === 0) return;
    const lines = events.map(ev => {
      const time = new Date(ev.timestamp).toLocaleTimeString();
      return `[${time}] ${ev.file}:${ev.line} -> ${ev.klass ? ev.klass + '#' : ''}${ev.method}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Descargar Registro de Eventos.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Agrupar por archivo
  const grouped = events.reduce((acc, ev) => {
    if (!acc[ev.file]) acc[ev.file] = [];
    acc[ev.file].push(ev);
    return acc;
  }, {} as Record<string, TraceEvent[]>);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col space-y-3 pb-3 border-b border-border/50">
        <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-brand" />
          Registro en Tiempo Real
        </h2>
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Inicia el registro para capturar la ejecución de Ruby en tiempo real durante la escalada o creación.
        </p>

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={() => setIsRecording(!isRecording)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all shadow-sm border",
              isRecording 
                ? "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20" 
                : "bg-brand text-white border-transparent hover:bg-brand-hover shadow-brand/20"
            )}
          >
            {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            {isRecording ? 'Detener Registro' : 'Registrar Eventos'}
          </button>
          
          
          {events.length > 0 && !isRecording && (
            <button
              onClick={downloadTraceLog}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-brand/10 text-brand hover:bg-brand/20 border border-brand/20 transition-colors"
              title="Descargar Registro de Eventos"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </button>
          )}

          <button
            onClick={clearTrace}
            disabled={events.length === 0}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-elevated text-text-secondary hover:text-text-primary border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Limpiar
          </button>
        </div>
      </div>

      {/* State indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-brand/5 border border-brand/10 text-[11px] text-brand font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand"></span>
          </span>
          Escuchando eventos de SketchUp...
        </div>
      )}

      {/* Trace List */}
      <div className="flex-1 overflow-y-auto -mx-4 px-4 space-y-4 pb-4">
        <AnimatePresence>
          {events.length === 0 && !isRecording && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-8 text-text-muted text-[11px]"
            >
              No hay eventos registrados.
            </motion.div>
          )}

          {Object.entries(grouped).map(([file, fileEvents]) => {
            const fileName = file.split(/[\\/]/).pop() || file;
            const fileDir = file.substring(0, file.length - fileName.length);
            
            return (
              <motion.div
                key={file}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-bg-elevated rounded-lg border border-border overflow-hidden"
              >
                <div className="px-3 py-2 bg-bg-surface border-b border-border flex items-start gap-2">
                  <FileCode className="w-3.5 h-3.5 text-brand mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-text-primary truncate" title={fileName}>
                      {fileName}
                    </div>
                    <div className="text-[9px] text-text-muted truncate mt-0.5" title={fileDir}>
                      {fileDir}
                    </div>
                  </div>
                </div>
                
                <div className="divide-y divide-border/50 max-h-48 overflow-y-auto">
                  {fileEvents.map((ev, i) => (
                    <div key={`${ev.id}-${i}`} className="px-3 py-1.5 flex flex-col gap-1 hover:bg-bg-surface/50 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-brand font-medium truncate">
                          {ev.klass ? `${ev.klass}#` : ''}{ev.method}
                        </span>
                        <span className="text-[9px] text-text-muted flex-shrink-0 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          Línea {ev.line}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
