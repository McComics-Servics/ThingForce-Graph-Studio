import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const DASHBOARD_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://localhost:${process.env.THINGFORCE_DASHBOARD_PORT || '5173'}`,
  `http://127.0.0.1:${process.env.THINGFORCE_DASHBOARD_PORT || '5173'}`,
]);

export function isAllowedDashboardOrigin(origin) {
  return typeof origin === 'string' && DASHBOARD_ORIGINS.has(origin);
}

export function isPathContained(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..\\`) &&
    !relativePath.startsWith('../') &&
    !isAbsolute(relativePath)
  );
}

function canonicalExistingPath(path) {
  if (!existsSync(path)) throw new Error(`La ruta no existe: ${path}`);
  return realpathSync.native(path);
}

/** Resolve an existing path and reject traversal and symlink escapes. */
export function resolveContainedExistingPath(root, candidate) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Raíz inválida');
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('Ruta inválida');

  const canonicalRoot = canonicalExistingPath(resolve(root));
  const candidateAbsolute = resolve(canonicalRoot, candidate);
  const canonicalCandidate = canonicalExistingPath(candidateAbsolute);
  if (!isPathContained(canonicalRoot, canonicalCandidate)) {
    throw new Error('La ruta solicitada está fuera de la raíz permitida');
  }
  return canonicalCandidate;
}

export function resolveAllowedOpenPath(candidate, allowedRoots) {
  if (typeof candidate !== 'string' || !candidate.trim() || !isAbsolute(candidate)) {
    throw new Error('Se requiere una ruta absoluta válida');
  }
  if (candidate.length > 4096) throw new Error('La ruta solicitada es demasiado larga');

  const canonicalCandidate = canonicalExistingPath(resolve(candidate));
  const canonicalRoots = allowedRoots
    .filter((root) => typeof root === 'string' && root.trim() && existsSync(root))
    .map((root) => realpathSync.native(resolve(root)));

  if (!canonicalRoots.some((root) => isPathContained(root, canonicalCandidate))) {
    throw new Error('La ruta solicitada no pertenece a un proyecto registrado');
  }
  return canonicalCandidate;
}

export function loadRegisteredProjectRoots(studioRoot) {
  const registryPath = resolve(studioRoot, 'config', 'projects.json');
  const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
  const projectRoots = Array.isArray(parsed.projects)
    ? parsed.projects.map((project) => project?.root).filter(Boolean)
    : [];
  return [resolve(studioRoot), ...projectRoots];
}
