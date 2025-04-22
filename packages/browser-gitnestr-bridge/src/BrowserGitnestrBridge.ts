import { EventEmitter } from 'events';
import {
  GitnestrRepository,
  GitnestrCommandOptions,
  GitnestrCommandResult,
  GitnestrEvent,
  GitnestrEventListener,
  GitnestrError,
  GitnestrErrorCode,
  BrowserGitnestrBridgeOptions,
  IPCRequest,
  IPCResponse,
  IPCMessage,
  RepositoryInfo
} from './types';

const DEFAULT_OPTIONS: Required<BrowserGitnestrBridgeOptions> = {
  timeout: 60000, // 1 minute default timeout
  relays: []
};

export class BrowserGitnestrBridge extends EventEmitter {
  private options: Required<BrowserGitnestrBridgeOptions>;
  private pendingRequests: Map<string, { 
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(options: BrowserGitnestrBridgeOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Set up IPC message handler
    window.addEventListener('message', this.handleIPCMessage.bind(this));
  }

  /**
   * Clone repository by info object
   */
  async cloneByInfo(info: RepositoryInfo, destPath?: string, branch?: string, keyAlias?: string): Promise<GitnestrRepository> {
    return this.clone(info.cloneUrl, destPath, branch, keyAlias);
  }

  /**
   * Handle IPC messages from the main process
   */
  private handleIPCMessage(event: MessageEvent): void {
    // Ignore messages that don't have the expected format
    if (!event.data || typeof event.data !== 'object') {
      return;
    }

    const message = event.data as IPCMessage;

    // Handle event messages
    if ('type' in message && message.type === 'event') {
      this.emit('event', message.event);
      return;
    }

    // Handle response messages
    if ('id' in message) {
      const pendingRequest = this.pendingRequests.get(message.id);
      if (pendingRequest) {
        // Clear the timeout
        clearTimeout(pendingRequest.timeout);
        this.pendingRequests.delete(message.id);

        // Handle error or success
        if (message.error) {
          pendingRequest.reject(
            new GitnestrError(
              message.error.message,
              message.error.code as GitnestrErrorCode,
              message.error.details
            )
          );
        } else {
          pendingRequest.resolve(message.result);
        }
      }
    }
  }

  /**
   * Send an IPC request to the main process
   */
  private async sendIPCRequest(method: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `${method}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Create the request
      const request: IPCRequest = {
        id,
        method,
        params
      };

      // Set up a timeout
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(
            new GitnestrError(
              `Request timed out: ${method}`,
              GitnestrErrorCode.TIMEOUT,
              { method, params }
            )
          );
        }
      }, this.options.timeout);

      // Store the pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send the request to the main process
      window.postMessage({ channel: 'gitnestr-bridge', request }, '*');
    });
  }

  /**
   * Initialize a new gitnestr repository
   */
  async init(repoPath: string): Promise<GitnestrRepository> {
    return this.sendIPCRequest('init', [repoPath]);
  }

  /**
   * Clone a gitnestr repository
   */
  async clone(url: string, destPath?: string, branch?: string, keyAlias?: string): Promise<GitnestrRepository> {
    return this.sendIPCRequest('clone', [url, destPath, branch, keyAlias]);
  }

  /**
   * Pull changes from a gitnestr repository
   */
  async pull(repoPath: string, branch?: string): Promise<GitnestrCommandResult> {
    return this.sendIPCRequest('pull', [repoPath, branch]);
  }

  /**
   * Push changes to a gitnestr repository
   */
  async push(repoPath: string, privateKey?: string, keyAlias?: string): Promise<GitnestrCommandResult> {
    return this.sendIPCRequest('push', [repoPath, privateKey, keyAlias]);
  }

  /**
   * Fetch changes from a gitnestr repository without merging
   */
  async fetch(repoPath: string, branch?: string): Promise<GitnestrCommandResult> {
    return this.sendIPCRequest('fetch', [repoPath, branch]);
  }

  /**
   * Retrieve archive DAG for a repository
   */
  async archive(url: string, branch?: string): Promise<string[]> {
    return this.sendIPCRequest('archive', [url, branch]);
  }

  /**
   * Generate a new key pair
   */
  async generateKeys(): Promise<{ privateKey: string; publicKey: string }> {
    return this.sendIPCRequest('generateKeys', []);
  }

  /**
   * Store a key with a passphrase
   */
  async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void> {
    return this.sendIPCRequest('storeKey', [alias, privateKey, passphrase]);
  }

  /**
   * Unlock a key with a passphrase
   */
  async unlockKey(alias: string, passphrase: string): Promise<string> {
    return this.sendIPCRequest('unlockKey', [alias, passphrase]);
  }

  /**
   * Commit changes to a gitnestr repository
   * @param repoPath The path to the repository
   * @param message The commit message
   * @returns A promise that resolves with the command result
   */
  async commit(repoPath: string, message: string): Promise<GitnestrCommandResult> {
    return this.sendIPCRequest('commit', [repoPath, message]);
  }

  /**
   * Write a file to a repository
   * @param repoPath The path to the repository (pubkey/reponame)
   * @param filePath The path to the file, relative to the repository root
   * @param content The content to write to the file (string or Buffer)
   * @returns A promise that resolves with success status and message
   */
  async writeFile(repoPath: string, filePath: string, content: string | Buffer): Promise<{ success: boolean; message: string }> {
    // Convert Buffer to base64 string if needed for IPC transmission
    const contentToSend = Buffer.isBuffer(content) ? content.toString('base64') : content;
    const isBase64 = Buffer.isBuffer(content);
    
    return this.sendIPCRequest('writeFile', [repoPath, filePath, contentToSend, isBase64]);
  }


  /**
   * Add an event listener
   */
  addListener(event: 'event', listener: GitnestrEventListener): this {
    return super.addListener(event, listener);
  }

  /**
   * Remove an event listener
   */
  removeListener(event: 'event', listener: GitnestrEventListener): this {
    return super.removeListener(event, listener);
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    for (const [id, { reject, timeout }] of this.pendingRequests.entries()) {
      clearTimeout(timeout);
      reject(
        new GitnestrError(
          'Request cancelled',
          GitnestrErrorCode.INTERNAL_ERROR,
          { id }
        )
      );
      this.pendingRequests.delete(id);
    }
  }
}
