import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export function assertStagingGraphPath(input, scriptDirectory) {
  if (!input) {
    throw new Error('Se requiere la ruta explícita de graph.json dentro de public/.staging');
  }
  const studioRoot = resolve(scriptDirectory, '..');
  const stagingRoot = resolve(studioRoot, 'public', '.staging');
  const candidate = resolve(input);
  const rel = relative(stagingRoot, candidate);
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('El enriquecedor solo puede escribir dentro de public/.staging');
  }
  if (basename(candidate).toLowerCase() !== 'graph.json') {
    throw new Error('El destino de enriquecimiento debe ser un graph.json de staging');
  }
  return candidate;
}
