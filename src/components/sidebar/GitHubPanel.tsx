import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, LogOut, Search } from 'lucide-react';
import { githubApi, type GitHubDeviceFlow, type GitHubRepository, type GitHubStatus } from '../../lib/githubApi';
import { useGraphStore } from '../../store/graphStore';

function GitHubMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.49c-2.23.49-2.7-1.08-2.7-1.08-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.88 2.34.67.07-.52.28-.88.51-1.08-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 3.72a7.6 7.6 0 0 1 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.74-3.65 3.94.29.25.54.74.54 1.49v2.34c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

export function GitHubPanel() {
  const initializeProjects = useGraphStore((state) => state.initializeProjects);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [flow, setFlow] = useState<GitHubDeviceFlow | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>('status');
  const [error, setError] = useState<string | null>(null);

  const loadRepositories = async () => {
    setBusy('repositories');
    try {
      const payload = await githubApi.repositories();
      setRepositories(payload.repositories);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    githubApi.status()
      .then((payload) => {
        if (cancelled) return;
        setStatus(payload);
        if (payload.connected) void loadRepositories();
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!flow) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await githubApi.poll(flow.flow_id);
        if (cancelled) return;
        if (result.status === 'connected') {
          setFlow(null);
          const nextStatus = await githubApi.status();
          if (cancelled) return;
          setStatus(nextStatus);
          await loadRepositories();
          return;
        }
        timer = setTimeout(poll, Math.max(5, result.retry_after || flow.interval) * 1000);
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setFlow(null);
        }
      }
    };
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [flow]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (needle
      ? repositories.filter((repo) => repo.full_name.toLowerCase().includes(needle))
      : repositories).slice(0, 30);
  }, [repositories, query]);

  const start = async () => {
    setBusy('connect');
    setError(null);
    try {
      const nextFlow = await githubApi.start();
      setFlow(nextFlow);
      window.open(nextFlow.verification_uri, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const importRepository = async (repo: GitHubRepository) => {
    setBusy(repo.full_name);
    setError(null);
    try {
      await githubApi.importRepository(repo.full_name);
      await initializeProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    await githubApi.logout();
    setStatus((current) => current ? { ...current, connected: false, user: null } : current);
    setRepositories([]);
    setFlow(null);
  };

  return (
    <section className="rounded-xl border border-border bg-bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitHubMark className="h-4 w-4 text-text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">GitHub independiente</span>
        </div>
        {status?.connected && (
          <button type="button" onClick={() => void logout()} title="Desconectar GitHub" className="rounded p-1 hover:bg-bg-elevated">
            <LogOut className="h-3.5 w-3.5 text-text-muted" />
          </button>
        )}
      </div>

      {busy === 'status' && <div className="mt-3 flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Comprobando…</div>}

      {status && !status.configured && (
        <p className="mt-3 text-[10px] leading-relaxed text-amber-400">Falta el Client ID en config/github-app.json.</p>
      )}

      {status?.configured && !status.connected && !flow && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] leading-relaxed text-text-muted">La cuenta de GitHub no se mezcla con Google ni con McComicsUp. El token permanece en este equipo.</p>
          <button type="button" onClick={() => void start()} disabled={busy === 'connect'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#24292f] px-3 py-2 text-xs font-semibold text-white hover:bg-[#30363d] disabled:opacity-50">
            {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitHubMark className="h-4 w-4" />}
            Conectar GitHub
          </button>
          {status.installation_url && (
            <a href={status.installation_url} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1 text-[10px] font-semibold text-brand hover:underline">
              Autorizar repositorios privados <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {flow && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-brand/5 p-3 text-center">
          <div className="text-[9px] uppercase tracking-widest text-text-muted">Código de GitHub</div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(flow.user_code)} title="Copiar código" className="mt-1 font-mono text-xl font-black tracking-[.18em] text-brand">{flow.user_code}</button>
          <a href={flow.verification_uri} target="_blank" rel="noreferrer" className="mt-2 flex items-center justify-center gap-1 text-[10px] font-semibold text-text-primary hover:underline">Abrir GitHub <ExternalLink className="h-3 w-3" /></a>
          <div className="mt-2 flex items-center justify-center gap-1 text-[9px] text-text-muted"><Loader2 className="h-3 w-3 animate-spin" /> Esperando autorización…</div>
        </div>
      )}

      {status?.connected && status.user && (
        <div className="mt-3">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <img src={status.user.avatar_url} alt="" className="h-7 w-7 rounded-full border border-border" referrerPolicy="no-referrer" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-text-primary">{status.user.name}</div>
              <div className="truncate text-[9px] text-text-muted">@{status.user.login}</div>
            </div>
            <Check className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar repositorio" className="w-full rounded-lg border border-border bg-bg-surface py-1.5 pl-8 pr-2 text-[10px] outline-none focus:border-brand" />
          </div>
          <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
            {busy === 'repositories' && <div className="flex items-center gap-2 p-2 text-[10px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando repositorios…</div>}
            {filtered.map((repo) => (
              <div key={repo.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-semibold text-text-primary">{repo.full_name}</div>
                  <div className="text-[8px] uppercase tracking-wider text-text-muted">{repo.private ? 'Privado' : 'Público'}</div>
                </div>
                <button type="button" onClick={() => void importRepository(repo)} disabled={busy !== null} className="rounded-md bg-brand px-2 py-1 text-[9px] font-bold text-white disabled:opacity-40">
                  {busy === repo.full_name ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Analizar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[9px] leading-relaxed text-red-400">{error}</p>}
    </section>
  );
}
