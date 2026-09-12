export const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;

function boundedString(value, label, { required = false, max = 4096 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${label} es obligatorio`);
    return value;
  }
  if (typeof value !== 'string') throw new Error(`${label} debe ser texto`);
  if (value.length > max) throw new Error(`${label} excede ${max} caracteres`);
  return value;
}

export function boundedInteger(value, fallback, { min, max, label }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} debe ser un entero entre ${min} y ${max}`);
  }
  return number;
}

export function normalizeToolArguments(toolName, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Los argumentos de la herramienta deben ser un objeto JSON');
  }
  const serialized = JSON.stringify(args);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TOOL_ARGUMENT_BYTES) {
    throw new Error('Los argumentos de la herramienta exceden 64 KiB');
  }

  const normalized = { ...args };
  normalized.projectId = boundedString(args.projectId, 'projectId', { max: 128 });

  switch (toolName) {
    case 'graph_projects':
      return {};
    case 'graph_search':
      normalized.query = boundedString(args.query, 'query', { required: true, max: 512 });
      normalized.type = boundedString(args.type, 'type', { max: 64 });
      normalized.module = boundedString(args.module, 'module', { max: 256 });
      normalized.limit = boundedInteger(args.limit, 20, { min: 1, max: 100, label: 'limit' });
      break;
    case 'graph_trace':
      normalized.nodeId = boundedString(args.nodeId, 'nodeId', { required: true });
      normalized.direction = boundedString(args.direction, 'direction', { max: 16 }) || 'both';
      if (!['both', 'upstream', 'downstream'].includes(normalized.direction)) {
        throw new Error('direction debe ser both, upstream o downstream');
      }
      normalized.depth = boundedInteger(args.depth, 4, { min: 1, max: 10, label: 'depth' });
      break;
    case 'graph_impact':
      normalized.nodeId = boundedString(args.nodeId, 'nodeId', { required: true });
      normalized.depth = boundedInteger(args.depth, 3, { min: 1, max: 10, label: 'depth' });
      break;
    case 'graph_bridge':
      normalized.name = boundedString(args.name, 'name', { required: true, max: 512 });
      break;
    case 'graph_node':
      normalized.id = boundedString(args.id, 'id', { required: true });
      break;
    case 'graph_read':
      normalized.nodeId = boundedString(args.nodeId, 'nodeId', { required: true });
      normalized.context = boundedInteger(args.context, 5, { min: 0, max: 100, label: 'context' });
      break;
    case 'lsp_definition':
    case 'lsp_references':
      normalized.file = boundedString(args.file, 'file', { required: true });
      normalized.line = boundedInteger(args.line, undefined, { min: 0, max: 10_000_000, label: 'line' });
      normalized.char = boundedInteger(args.char, undefined, { min: 0, max: 1_000_000, label: 'char' });
      if (normalized.line === undefined) throw new Error('line es obligatorio');
      if (normalized.char === undefined) throw new Error('char es obligatorio');
      break;
    default:
      throw new Error(`Herramienta desconocida: ${toolName}`);
  }
  return normalized;
}
