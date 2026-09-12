/**
 * fileOpener — Calls the local Vite API to open a file/folder in the OS.
 */

const GRAPH_ROOT_KEY = 'thingforce_graph_root';

export function getGraphRoot(): string {
  return localStorage.getItem(GRAPH_ROOT_KEY) || '';
}

export function setGraphRoot(root: string) {
  localStorage.setItem(GRAPH_ROOT_KEY, root);
}

export async function openInOS(relativePath: string) {
  const root = getGraphRoot();
  if (!root) {
    console.warn('[fileOpener] No graph root configured');
    return;
  }
  const fullPath = `${root}/${relativePath}`.replace(/\//g, '\\');
  try {
    await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath }),
    });
  } catch (e) {
    console.error('[fileOpener] Failed to open:', e);
  }
}

export async function openFolderInOS(relativePath: string) {
  const root = getGraphRoot();
  if (!root) return;
  const fullPath = `${root}/${relativePath}`.replace(/\//g, '\\');
  try {
    await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath, folder: true }),
    });
  } catch (e) {
    console.error('[fileOpener] Failed to open folder:', e);
  }
}
