#!/usr/bin/env node

import { resolve } from 'path';
import { ProjectRegistry } from '../server/project-registry.mjs';
import { generateProjectGraph } from '../server/project-graph-runner.mjs';

const studioRoot = resolve(import.meta.dirname, '..');
const projectId = process.argv[2];

if (!projectId) {
  console.error('Uso: node scripts/generateProjectGraph.mjs <project-id> [--incremental]');
  process.exit(2);
}

const registry = new ProjectRegistry({ studioRoot });
const project = registry.get(projectId);
if (!project) {
  console.error(`Proyecto no registrado: ${projectId}`);
  process.exit(2);
}

try {
  const summary = await generateProjectGraph({
    project,
    graphPath: registry.graphPath(project),
    studioRoot,
    publicRoot: registry.publicRoot,
    force: !process.argv.includes('--incremental'),
  });
  registry.markGenerated(project.id, summary);
  console.log(JSON.stringify({ project: project.id, ...summary }, null, 2));
} catch (error) {
  registry.markError(project.id, error);
  console.error(error.stack || error.message);
  process.exit(1);
}
