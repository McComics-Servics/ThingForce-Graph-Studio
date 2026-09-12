#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || '');
const output = resolve(process.argv[3] || '');
const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.venv', 'venv', 'env', 'node_modules',
  'dist', 'build', 'coverage', 'vendor', 'target', '.next', '.nuxt', '.cache', '__pycache__',
]);
const sourceExtensions = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html', '.htm',
  '.java', '.js', '.jsx', '.json', '.kt', '.kts', '.lua', '.md', '.mjs', '.php', '.ps1',
  '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.swift', '.toml', '.ts', '.tsx', '.vue',
  '.xml', '.yaml', '.yml',
]);
const extensionCandidates = ['', ...sourceExtensions, '/index.js', '/index.ts', '/index.tsx', '/index.jsx'];

function isInside(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function normalizedRelative(path) {
  return relative(root, path).replace(/\\/g, '/');
}

function languageFor(extension) {
  return ({
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.css': 'css', '.dart': 'dart',
    '.go': 'go', '.h': 'c', '.hpp': 'cpp', '.html': 'html', '.htm': 'html', '.java': 'java',
    '.js': 'javascript', '.jsx': 'javascript', '.json': 'json', '.kt': 'kotlin', '.kts': 'kotlin',
    '.lua': 'lua', '.md': 'markdown', '.mjs': 'javascript', '.php': 'php', '.ps1': 'powershell',
    '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.scss': 'scss', '.sh': 'shell', '.sql': 'sql',
    '.swift': 'swift', '.toml': 'toml', '.ts': 'typescript', '.tsx': 'typescript', '.vue': 'vue',
    '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
  })[extension] || 'text';
}

function scan(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name.toLowerCase())) continue;
    const absolute = join(directory, entry.name);
    if (!isInside(root, absolute)) continue;
    if (entry.isDirectory()) {
      scan(absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!sourceExtensions.has(extension)) continue;
    const stat = statSync(absolute);
    if (stat.size > 5 * 1024 * 1024) continue;
    files.push({ absolute, relative: normalizedRelative(absolute), extension, stat });
  }
}

function extractReferences(content) {
  const references = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require_relative\s*(?:\(?\s*)['"]([^'"]+)['"]/g,
    /(?:from|import)\s+([A-Za-z0-9_./-]+)/g,
    /(?:src|href)\s*=\s*['"]([^'"?#]+)['"]/g,
    /url\(\s*['"]?([^'"?#)]+)['"]?\s*\)/g,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) references.add(match[1]);
  }
  return references;
}

function resolveReference(sourceRelative, reference, fileIds) {
  if (!reference || /^(?:[a-z]+:|#|@)/i.test(reference)) return null;
  const sourceDirectory = dirname(sourceRelative);
  const base = reference.startsWith('.')
    ? resolve(root, sourceDirectory, reference)
    : resolve(root, reference.replace(/^\//, ''));
  if (!isInside(root, base)) return null;
  for (const suffix of extensionCandidates) {
    const candidate = normalizedRelative(`${base}${suffix}`);
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

if (!root || !output || !statSync(root).isDirectory()) {
  console.error('Uso: node scripts/generate-base-graph.mjs <raíz-proyecto> <graph.json>');
  process.exit(2);
}

const files = [];
scan(root, files);
const fileIds = new Set(files.map((file) => file.relative));
const contents = new Map();
const nodes = files.map((file) => {
  let content = '';
  try {
    content = readFileSync(file.absolute, 'utf8');
    if (content.includes('\u0000')) content = '';
  } catch {
    content = '';
  }
  contents.set(file.relative, content);
  const digest = createHash('sha1').update(content).digest('hex');
  return {
    id: `file:${file.relative}`,
    type: 'file',
    path: file.absolute,
    relative_path: file.relative,
    name: basename(file.relative),
    fingerprint: { sha1: digest, size: file.stat.size, mtime: file.stat.mtime.toISOString() },
    classification: {
      language: languageFor(file.extension),
      extension: file.extension,
      layer: 'source',
      module_name: null,
      labels: [],
    },
    general: {},
    specialized: {},
    generated_at: new Date().toISOString(),
  };
});

const edges = [];
const edgeKeys = new Set();
for (const file of files) {
  const content = contents.get(file.relative) || '';
  for (const reference of extractReferences(content)) {
    const target = resolveReference(file.relative, reference, fileIds);
    if (!target || target === file.relative) continue;
    const key = `${file.relative}|${target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ from: `file:${file.relative}`, to: `file:${target}`, type: 'references_file' });
  }
}

const languages = {};
for (const node of nodes) {
  const language = node.classification.language;
  languages[language] = (languages[language] || 0) + 1;
}
const graph = {
  schema_version: 1,
  root,
  nodes,
  edges,
  summary: {
    generator: 'thingforce_local_generic',
    files_scanned: files.length,
    files_changed: files.length,
    files_reused_from_cache: 0,
    changed_files: files.map((file) => file.relative),
    reused_files: [],
    languages,
    layers: { source: files.length },
  },
  generated_at: new Date().toISOString(),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(graph), 'utf8');
writeFileSync(join(dirname(output), 'cache.json'), JSON.stringify({
  schema_version: 1,
  root,
  generated_at: graph.generated_at,
  files: Object.fromEntries(nodes.map((node) => [node.relative_path, node.fingerprint])),
}), 'utf8');
console.log(JSON.stringify({ files: files.length, edges: edges.length }));
