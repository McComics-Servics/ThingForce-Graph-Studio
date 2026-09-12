import Fuse from 'fuse.js';

export function setupFuzzySearch(nodes: any[]) {
  return new Fuse(nodes, {
    keys: [
      { name: 'id', weight: 0.5 },
      { name: 'name', weight: 0.2 },
      { name: 'relative_path', weight: 0.15 },
      { name: 'classification.module_name', weight: 0.1 },
      { name: 'type', weight: 0.05 }
    ],
    threshold: 0.35,
    includeScore: true,
    ignoreLocation: true
  });
}
