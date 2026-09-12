const LOCAL_API = import.meta.env.VITE_GRAPH_API || 'http://127.0.0.1:3098';

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  updated_at: string;
  default_branch: string;
  html_url: string;
}

export interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  user: GitHubUser | null;
  app_slug: string | null;
  installation_url: string | null;
  storage: string;
  error?: string;
}

export interface GitHubDeviceFlow {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  expires_at: string;
  interval: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_API}${path}`, {
    cache: 'no-store',
    ...init,
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...(init.headers || {}) }
      : init?.headers,
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`El servicio local respondió con un formato inválido (${response.status})`);
  }
  if (!response.ok && response.status !== 202) {
    throw new Error(String(payload.error || `${response.status} ${response.statusText}`));
  }
  return payload as T;
}

export const githubApi = {
  status: () => request<GitHubStatus>('/api/github/status'),
  start: () => request<GitHubDeviceFlow>('/api/github/device/start', { method: 'POST' }),
  poll: (flowId: string) => request<{ status: 'pending' | 'connected'; retry_after?: number; user?: GitHubUser }>(
    '/api/github/device/poll',
    { method: 'POST', body: JSON.stringify({ flow_id: flowId }) },
  ),
  repositories: () => request<{ repositories: GitHubRepository[] }>('/api/github/repositories'),
  importRepository: (fullName: string) => request<{ project: { id: string }; cloned: boolean }>(
    '/api/github/import',
    { method: 'POST', body: JSON.stringify({ full_name: fullName }) },
  ),
  logout: () => request<{ connected: false }>('/api/github/logout', { method: 'POST' }),
};
