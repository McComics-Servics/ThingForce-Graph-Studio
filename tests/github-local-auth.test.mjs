import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubLocalAuth } from '../server/github-local-auth.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Device Flow conecta sin devolver el token al navegador', async () => {
  const studioRoot = mkdtempSync(join(tmpdir(), 'thingforce-github-'));
  try {
    mkdirSync(join(studioRoot, 'config'), { recursive: true });
    writeFileSync(join(studioRoot, 'config', 'github-app.json'), JSON.stringify({
      client_id: 'Iv23liWupCnYHsjRRHKd', app_slug: 'thingforce-graph',
    }));
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/device/code')) return jsonResponse({
        device_code: 'device-secret', user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
      });
      if (String(url).endsWith('/oauth/access_token')) return jsonResponse({
        access_token: 'user-access-secret', token_type: 'bearer', expires_in: 28800,
      });
      if (String(url).endsWith('/user')) return jsonResponse({
        login: 'octocat', name: 'Octo Cat', avatar_url: 'https://example.test/avatar.png',
        html_url: 'https://github.com/octocat',
      });
      throw new Error(`Solicitud inesperada: ${url}`);
    };
    const auth = new GitHubLocalAuth({ studioRoot, fetchImpl });
    const flow = await auth.startDeviceFlow();
    const connected = await auth.pollDeviceFlow(flow.flow_id);
    assert.equal(connected.status, 'connected');
    assert.equal(connected.user.login, 'octocat');
    assert.doesNotMatch(JSON.stringify(connected), /user-access-secret|device-secret/);
    assert.equal((await auth.status()).connected, true);
    assert.equal(calls.length, 3);
  } finally {
    rmSync(studioRoot, { recursive: true, force: true });
  }
});

test('importa sólo un repositorio autorizado y no coloca el token en los argumentos de git', async () => {
  const studioRoot = mkdtempSync(join(tmpdir(), 'thingforce-clone-'));
  try {
    mkdirSync(join(studioRoot, 'config'), { recursive: true });
    writeFileSync(join(studioRoot, 'config', 'github-app.json'), JSON.stringify({
      client_id: 'Iv23liWupCnYHsjRRHKd', app_slug: 'thingforce-graph',
    }));
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/device/code')) return jsonResponse({
        device_code: 'device-secret', user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
      });
      if (String(url).endsWith('/oauth/access_token')) return jsonResponse({ access_token: 'clone-secret' });
      if (String(url).endsWith('/user')) return jsonResponse({ login: 'octocat', avatar_url: '', html_url: '' });
      if (String(url).includes('/user/repos?')) return jsonResponse([{
        id: 1, name: 'hello-world', full_name: 'octocat/hello-world', private: true,
        updated_at: '2026-01-01T00:00:00Z', default_branch: 'main', html_url: 'https://github.com/octocat/hello-world',
      }]);
      throw new Error(`Solicitud inesperada: ${url}`);
    };
    let gitCall;
    const execFileImpl = async (command, args, options) => {
      gitCall = { command, args, options };
      mkdirSync(join(args.at(-1), '.git'), { recursive: true });
      return { stdout: '', stderr: '' };
    };
    const auth = new GitHubLocalAuth({ studioRoot, fetchImpl, execFileImpl });
    const flow = await auth.startDeviceFlow();
    await auth.pollDeviceFlow(flow.flow_id);
    const imported = await auth.importRepository('octocat/hello-world');
    assert.equal(imported.repository.full_name, 'octocat/hello-world');
    assert.equal(imported.cloned, true);
    assert.equal(gitCall.command, 'git');
    assert.doesNotMatch(JSON.stringify(gitCall.args), /clone-secret/);
    const encodedCredentials = gitCall.options.env.GIT_CONFIG_VALUE_0.split(' ').at(-1);
    assert.match(Buffer.from(encodedCredentials, 'base64').toString('utf8'), /clone-secret/);
    await assert.rejects(() => auth.importRepository('evil/not-authorized'), /no está autorizado/);
  } finally {
    rmSync(studioRoot, { recursive: true, force: true });
  }
});
