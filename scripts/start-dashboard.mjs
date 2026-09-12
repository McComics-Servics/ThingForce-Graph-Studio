#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';

const studioRoot = resolve(import.meta.dirname, '..');
const mcpPort = String(process.env.MCP_HTTP_PORT || '3098');
const dashboardPort = String(process.env.THINGFORCE_DASHBOARD_PORT || '5173');
const graphApi = `http://127.0.0.1:${mcpPort}`;
const apiUrl = `${graphApi}/api/health`;
const dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
const children = new Set();
let stopping = false;

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function spawnNode(args, label, extraEnvironment = {}) {
  const child = spawn(process.execPath, args, {
    cwd: studioRoot,
    env: { ...process.env, ...extraEnvironment },
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  });
  child.once('error', (error) => {
    console.error(`[dashboard-supervisor] ${label}: ${error.message}`);
  });
  children.add(child);
  child.termination = once(child, 'exit')
    .then(([code, signal]) => ({ service: label, code, signal }))
    .catch((error) => ({ service: label, code: 1, signal: null, error }));
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitForHttp(url, child, label, { timeoutMs = 15_000, verify } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} terminó antes de quedar disponible (código ${child.exitCode})`);
    }
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        const accepted = verify ? await verify(response) : true;
        // Give a strict-port failure enough time to surface instead of
        // accepting an unrelated process that already owns the URL.
        await delay(150);
        if (accepted && child.exitCode === null) return;
      }
    } catch {
      // El proceso todavía está iniciando.
    }
    await delay(250);
  }
  throw new Error(`${label} no respondió en ${url} tras ${timeoutMs} ms`);
}

function stopChildren() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

function openDashboard() {
  const browserCommand = process.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/c', 'start', '', dashboardUrl] }
    : process.platform === 'darwin'
      ? { command: 'open', args: [dashboardUrl] }
      : { command: 'xdg-open', args: [dashboardUrl] };
  const browser = spawn(
    browserCommand.command,
    browserCommand.args,
    {
      cwd: studioRoot,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    },
  );
  browser.unref();
}

async function main() {
  const instanceToken = randomUUID();
  const mcp = spawnNode(
    ['server/mcp-server.mjs'],
    'MCP/API',
    {
      DASHBOARD_INSTANCE_TOKEN: instanceToken,
      MCP_HTTP_PORT: mcpPort,
      THINGFORCE_DASHBOARD_PORT: dashboardPort,
    },
  );
  try {
    await waitForHttp(apiUrl, mcp, 'MCP/API', {
      verify: async (response) => {
        const health = await response.json();
        return health.pid === mcp.pid && health.instance_token === instanceToken;
      },
    });
    const vite = spawnNode(
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', dashboardPort, '--strictPort'],
      'Vite',
      { VITE_GRAPH_API: graphApi, THINGFORCE_DASHBOARD_PORT: dashboardPort },
    );
    await waitForHttp(dashboardUrl, vite, 'Vite');
    openDashboard();
    console.log('[dashboard-supervisor] Dashboard y MCP conectados. Ctrl+C cierra ambos.');

    const result = await Promise.race([
      vite.termination,
      mcp.termination,
    ]);
    if (!stopping && result.service === 'MCP/API') {
      throw new Error(`MCP/API terminó inesperadamente (código ${result.code}, señal ${result.signal})`);
    }
    process.exitCode = result.code || 0;
  } finally {
    stopChildren();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopChildren();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  });
}
process.on('exit', stopChildren);

main().catch((error) => {
  console.error(`[dashboard-supervisor] ERROR: ${error.message}`);
  stopChildren();
  process.exitCode = 1;
});
