const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii');

export const DEFAULT_MAX_HEADER_BYTES = 8 * 1024;
export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;

function framingError(message) {
  const error = new Error(message);
  error.code = 'MCP_FRAMING_ERROR';
  return error;
}

/**
 * Incremental Content-Length decoder for MCP/LSP streams.
 * All offsets are byte offsets. This is essential when JSON contains UTF-8
 * characters whose byte length differs from JavaScript string length.
 */
export class ContentLengthDecoder {
  constructor({
    maxHeaderBytes = DEFAULT_MAX_HEADER_BYTES,
    maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  } = {}) {
    this.maxHeaderBytes = maxHeaderBytes;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, incoming])
      : Buffer.from(incoming);

    const messages = [];
    while (this.buffer.length) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) {
        if (this.buffer.length > this.maxHeaderBytes) {
          this.buffer = Buffer.alloc(0);
          throw framingError('Content-Length header exceeds the configured limit');
        }
        break;
      }
      if (headerEnd > this.maxHeaderBytes) {
        this.buffer = Buffer.alloc(0);
        throw framingError('Content-Length header exceeds the configured limit');
      }

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const matches = [...header.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
      if (matches.length !== 1) {
        this.buffer = Buffer.alloc(0);
        throw framingError('Exactly one valid Content-Length header is required');
      }

      const contentLength = Number(matches[0][1]);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        this.buffer = Buffer.alloc(0);
        throw framingError('Invalid Content-Length value');
      }
      if (contentLength > this.maxMessageBytes) {
        this.buffer = Buffer.alloc(0);
        throw framingError('MCP message exceeds the configured limit');
      }

      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      const frameEnd = bodyStart + contentLength;
      if (this.buffer.length < frameEnd) break;

      messages.push(this.buffer.subarray(bodyStart, frameEnd));
      this.buffer = this.buffer.subarray(frameEnd);
    }
    return messages;
  }
}

export function encodeContentLengthMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}
