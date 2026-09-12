import { spawn } from 'child_process';
import {
  ContentLengthDecoder,
  encodeContentLengthMessage,
} from './content-length-framing.mjs';
import { resolveContainedExistingPath } from './file-open-policy.mjs';

export class LspClient {
  constructor(cmd, args, workspaceRoot) {
    this.proc = spawn(cmd, args, { cwd: workspaceRoot, shell: false, windowsHide: true });
    this.workspaceRoot = workspaceRoot;
    this.decoder = new ContentLengthDecoder();
    this.msgId = 1;
    this.pending = new Map();
    this.ready = false;
    this.initError = null;

    this.proc.stdout.on('data', data => {
      try {
        for (const payload of this.decoder.push(data)) {
          this.handleMessage(JSON.parse(payload.toString('utf8')));
        }
      } catch (error) {
        console.error('[LSP Parse Error]', error);
      }
    });

    this.proc.stderr.on('data', () => {
      // Ignore normal stderr noise unless debugging
    });

    this.proc.on('error', err => {
      console.error(`[LSP Client Error] ${err.message}`);
      this.initError = err.message;
    });
    
    this.proc.on('close', code => {
      if (code !== 0) {
        console.error(`[LSP Client Closed] exit code ${code}`);
        this.initError = `Process closed with code ${code}`;
      }
    });
  }

  handleMessage(msg) {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  }

  async sendRequest(method, params) {
    if (this.initError) throw new Error(`LSP not available: ${this.initError}`);
    
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      
      this.proc.stdin.write(encodeContentLengthMessage({ jsonrpc: '2.0', id, method, params }));
    });
  }

  sendNotification(method, params) {
    if (this.initError) return;
    this.proc.stdin.write(encodeContentLengthMessage({ jsonrpc: '2.0', method, params }));
  }

  async initialize() {
    const rootUri = 'file:///' + this.workspaceRoot.replace(/\\/g, '/');
    try {
      const result = await this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: rootUri,
        rootPath: this.workspaceRoot,
        capabilities: {
          textDocument: {
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
          }
        }
      });
      this.sendNotification('initialized', {});
      this.ready = true;
      console.error(`[LSP Client] Initialized successfully in ${this.workspaceRoot}`);
      return result;
    } catch (e) {
      this.initError = e.message;
      console.error(`[LSP Client] Initialization failed: ${e.message}`);
      throw e;
    }
  }

  async definition(file, line, char) {
    if (!this.ready) throw new Error("LSP not initialized");
    const absPath = resolveContainedExistingPath(this.workspaceRoot, file);
    const uri = 'file:///' + absPath.replace(/\\/g, '/');
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character: char }
    });
  }

  async references(file, line, char) {
    if (!this.ready) throw new Error("LSP not initialized");
    const absPath = resolveContainedExistingPath(this.workspaceRoot, file);
    const uri = 'file:///' + absPath.replace(/\\/g, '/');
    return this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line, character: char },
      context: { includeDeclaration: true }
    });
  }
}
