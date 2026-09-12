import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error Runtime-only ESM policy shared with the local MCP server.
import { isAllowedDashboardOrigin, loadRegisteredProjectRoots, resolveAllowedOpenPath } from './server/file-open-policy.mjs'

const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)))
const MAX_OPEN_BODY_BYTES = 16 * 1024

function nativeOpenCommand(path: string): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: 'explorer.exe', args: [path] }
  if (process.platform === 'darwin') return { command: 'open', args: [path] }
  return { command: 'xdg-open', args: [path] }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/dashboard_grafo/',
  plugins: [
    tailwindcss(),
    react(),
    // Local-only API plugin for opening files in OS
    {
      name: 'file-opener-api',
      configureServer(server) {
        // --- NUEVO ENDPOINT PARA TRAZABILIDAD ---
        server.middlewares.use('/api/trace', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method not allowed');
            return;
          }
          if (!isAllowedDashboardOrigin(req.headers.origin)) {
            res.statusCode = 403;
            res.end('Origin not allowed');
            return;
          }
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const traceData = JSON.parse(body);
              // Emitir al frontend usando el websocket de Vite
              server.ws.send('mccomics:trace', traceData);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end('Invalid JSON');
            }
          });
        });

        server.middlewares.use('/api/open', (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method not allowed');
            return;
          }
          if (!isAllowedDashboardOrigin(req.headers.origin)) {
            res.statusCode = 403;
            res.end('Origin not allowed');
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;
          let tooLarge = false;
          req.on('data', chunk => {
            if (tooLarge) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += bytes.length;
            if (totalBytes > MAX_OPEN_BODY_BYTES) {
              tooLarge = true;
              res.statusCode = 413;
              res.end('Request body too large');
              return;
            }
            chunks.push(bytes);
          });
          req.on('end', () => {
            if (tooLarge) return;
            try {
              const { path } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (!path) {
                res.statusCode = 400;
                res.end('Missing path');
                return;
              }
              const safePath = resolveAllowedOpenPath(
                path,
                loadRegisteredProjectRoots(STUDIO_ROOT),
              );
              const openCommand = nativeOpenCommand(safePath)
              const opener = spawn(openCommand.command, openCommand.args, {
                detached: true,
                shell: false,
                stdio: 'ignore',
                windowsHide: true,
              });
              opener.once('error', (error) => console.error('[file-opener]', error.message));
              opener.unref();
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
            } catch (error: unknown) {
              res.statusCode = 400;
              res.end(error instanceof Error ? error.message : 'Invalid request');
            }
          });
        });
      }
    }
  ],
})
