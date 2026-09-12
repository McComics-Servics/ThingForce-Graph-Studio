import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const GITHUB_API = 'https://api.github.com';
const GITHUB_LOGIN = 'https://github.com/login';
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ThingForce-Graph-Studio',
};

function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function readOptionalJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`No se pudo leer ${path}: ${error.message}`);
  }
}

export function loadGitHubAppConfig(studioRoot) {
  const file = readOptionalJson(resolve(studioRoot, 'config', 'github-app.json'));
  const clientId = String(process.env.THINGFORCE_GITHUB_CLIENT_ID || file.client_id || '').trim();
  const appSlug = String(process.env.THINGFORCE_GITHUB_APP_SLUG || file.app_slug || '').trim();
  const validClientId = /^[A-Za-z0-9]{10,80}$/.test(clientId);
  const validSlug = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(appSlug);
  return {
    configured: validClientId,
    clientId: validClientId ? clientId : '',
    appSlug: validSlug ? appSlug : '',
    installationUrl: validSlug ? `https://github.com/apps/${appSlug}/installations/new` : null,
  };
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GitHub respondió con un formato inesperado (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || `GitHub respondió ${response.status}`);
  }
  return payload;
}

function formBody(fields) {
  return new URLSearchParams(Object.entries(fields).filter(([, value]) => value != null)).toString();
}

export class GitHubLocalAuth {
  constructor({ studioRoot, fetchImpl = fetch, execFileImpl = execFile } = {}) {
    this.studioRoot = resolve(studioRoot || process.cwd());
    this.fetch = fetchImpl;
    this.execFile = execFileImpl;
    this.flows = new Map();
    this.credentials = null;
    this.user = null;
  }

  config() {
    const config = loadGitHubAppConfig(this.studioRoot);
    return {
      configured: config.configured,
      app_slug: config.appSlug || null,
      installation_url: config.installationUrl,
      storage: 'memoria local del proceso; nunca se envía a McComicsUp',
    };
  }

  #requireConfig() {
    const config = loadGitHubAppConfig(this.studioRoot);
    if (!config.configured) {
      const error = new Error('Falta configurar config/github-app.json con el Client ID de la GitHub App');
      error.statusCode = 503;
      throw error;
    }
    return config;
  }

  async startDeviceFlow() {
    const config = this.#requireConfig();
    const payload = await requestJson(this.fetch, `${GITHUB_LOGIN}/device/code`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': API_HEADERS['User-Agent'],
      },
      body: formBody({ client_id: config.clientId }),
    });
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
      throw new Error('GitHub no devolvió un Device Flow válido');
    }
    const flowId = randomUUID();
    const expiresAt = Date.now() + Number(payload.expires_in || 900) * 1000;
    this.flows.set(flowId, {
      deviceCode: payload.device_code,
      expiresAt,
      intervalSeconds: Math.max(5, Number(payload.interval || 5)),
      lastPollAt: 0,
    });
    return {
      flow_id: flowId,
      user_code: payload.user_code,
      verification_uri: payload.verification_uri,
      expires_at: new Date(expiresAt).toISOString(),
      interval: Math.max(5, Number(payload.interval || 5)),
    };
  }

  async pollDeviceFlow(flowId) {
    const config = this.#requireConfig();
    const flow = this.flows.get(String(flowId || ''));
    if (!flow) {
      const error = new Error('El flujo de GitHub no existe o ya terminó');
      error.statusCode = 404;
      throw error;
    }
    if (Date.now() >= flow.expiresAt) {
      this.flows.delete(flowId);
      const error = new Error('El código de GitHub expiró; genera uno nuevo');
      error.statusCode = 410;
      throw error;
    }
    const minimumDelay = flow.intervalSeconds * 1000;
    if (Date.now() - flow.lastPollAt < minimumDelay - 250) {
      return { status: 'pending', retry_after: flow.intervalSeconds };
    }
    flow.lastPollAt = Date.now();

    const response = await this.fetch(`${GITHUB_LOGIN}/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': API_HEADERS['User-Agent'],
      },
      body: formBody({
        client_id: config.clientId,
        device_code: flow.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (payload.error === 'authorization_pending') {
      return { status: 'pending', retry_after: flow.intervalSeconds };
    }
    if (payload.error === 'slow_down') {
      flow.intervalSeconds += Number(payload.interval || 5);
      return { status: 'pending', retry_after: flow.intervalSeconds };
    }
    if (payload.error) {
      this.flows.delete(flowId);
      const error = new Error(payload.error_description || payload.error);
      error.statusCode = payload.error === 'access_denied' ? 403 : 400;
      throw error;
    }
    if (!response.ok || !payload.access_token) {
      throw new Error('GitHub no entregó un token de acceso válido');
    }

    this.credentials = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || null,
      expiresAt: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : null,
      refreshExpiresAt: payload.refresh_token_expires_in
        ? Date.now() + Number(payload.refresh_token_expires_in) * 1000
        : null,
    };
    this.flows.clear();
    this.user = await this.#fetchUser();
    return { status: 'connected', user: this.user };
  }

  async #accessToken() {
    if (!this.credentials?.accessToken) {
      const error = new Error('Conecta una cuenta de GitHub primero');
      error.statusCode = 401;
      throw error;
    }
    if (!this.credentials.expiresAt || Date.now() < this.credentials.expiresAt - 60_000) {
      return this.credentials.accessToken;
    }
    if (!this.credentials.refreshToken || (this.credentials.refreshExpiresAt && Date.now() >= this.credentials.refreshExpiresAt)) {
      this.logout();
      const error = new Error('La sesión de GitHub expiró; vuelve a conectarla');
      error.statusCode = 401;
      throw error;
    }
    const config = this.#requireConfig();
    const payload = await requestJson(this.fetch, `${GITHUB_LOGIN}/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': API_HEADERS['User-Agent'],
      },
      body: formBody({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
      }),
    });
    this.credentials = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || this.credentials.refreshToken,
      expiresAt: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : null,
      refreshExpiresAt: payload.refresh_token_expires_in
        ? Date.now() + Number(payload.refresh_token_expires_in) * 1000
        : this.credentials.refreshExpiresAt,
    };
    return this.credentials.accessToken;
  }

  async #githubApi(path) {
    const token = await this.#accessToken();
    return requestJson(this.fetch, `${GITHUB_API}${path}`, {
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    });
  }

  async #fetchUser() {
    const user = await this.#githubApi('/user');
    return {
      login: user.login,
      name: user.name || user.login,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
    };
  }

  async status() {
    if (!this.credentials) return { connected: false, user: null, ...this.config() };
    try {
      if (!this.user) this.user = await this.#fetchUser();
      return { connected: true, user: this.user, ...this.config() };
    } catch (error) {
      if (error?.statusCode === 401) this.logout();
      return { connected: false, user: null, error: error.message, ...this.config() };
    }
  }

  async repositories() {
    const repositories = [];
    for (let page = 1; page <= 5; page += 1) {
      const batch = await this.#githubApi(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
      if (!Array.isArray(batch)) throw new Error('GitHub devolvió una lista de repositorios inválida');
      repositories.push(...batch.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        private: Boolean(repo.private),
        updated_at: repo.updated_at,
        default_branch: repo.default_branch,
        html_url: repo.html_url,
      })));
      if (batch.length < 100) break;
    }
    return repositories;
  }

  async importRepository(fullName) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(fullName || ''))) {
      const error = new Error('Repositorio inválido');
      error.statusCode = 400;
      throw error;
    }
    const authorized = (await this.repositories()).find((repo) => repo.full_name === fullName);
    if (!authorized) {
      const error = new Error('Ese repositorio no está autorizado para esta GitHub App');
      error.statusCode = 403;
      throw error;
    }

    const repositoryRoot = resolve(this.studioRoot, 'workspace', 'repositories');
    mkdirSync(repositoryRoot, { recursive: true });
    const target = resolve(repositoryRoot, fullName.replace('/', '--'));
    if (!isInside(repositoryRoot, target)) throw new Error('Ruta local de repositorio insegura');
    if (existsSync(target)) {
      if (!statSync(target).isDirectory() || !existsSync(resolve(target, '.git'))) {
        throw new Error(`La ruta local ya existe y no es un clon Git válido: ${target}`);
      }
      return { root: target, repository: authorized, cloned: false };
    }

    const token = await this.#accessToken();
    const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    try {
      await this.execFile('git', [
        'clone', '--depth', '1', '--no-tags',
        `https://github.com/${fullName}.git`, target,
      ], {
        cwd: repositoryRoot,
        timeout: 5 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: authHeader,
        },
      });
    } catch (error) {
      if (existsSync(target) && isInside(repositoryRoot, target)) rmSync(target, { recursive: true, force: true });
      throw new Error(`No se pudo clonar ${fullName}: ${error.stderr || error.message}`);
    }
    return { root: target, repository: authorized, cloned: true };
  }

  logout() {
    this.credentials = null;
    this.user = null;
    this.flows.clear();
    return { connected: false };
  }
}
