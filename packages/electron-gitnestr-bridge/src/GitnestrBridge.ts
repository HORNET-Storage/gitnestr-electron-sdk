const { execa } = await import('execa');
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  GitnestrRepository,
  GitnestrCommandOptions,
  GitnestrCommandResult,
  GitnestrEvent,
  GitnestrEventListener,
  GitnestrError,
  GitnestrErrorCode,
  GitnestrBridgeOptions
} from './types/index.js';
import { error } from 'console';

const DEFAULT_OPTIONS: Required<GitnestrBridgeOptions> = {
  gitnestrPath: 'gitnestr.exe',
  timeout: 60000,
  env: {},
  relays: []
};

export class GitnestrBridge extends EventEmitter {
  private options: Required<GitnestrBridgeOptions>;
  private activeProcesses: Map<string, ReturnType<typeof execa>> = new Map();

  constructor(options: GitnestrBridgeOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a gitnestr command
   */
  async executeCommand(
    command: string,
    args: string[] = [],
    options: GitnestrCommandOptions = {}
  ): Promise<GitnestrCommandResult> {
    const commandId = `${command}-${Date.now()}`;
    const commandOptions = {
        cwd: options.cwd || process.cwd(),
        timeout: options.timeout || this.options.timeout,
        env: { ...this.options.env, ...options.env },
        stdio: Array.isArray(options.stdio)
          ? options.stdio as ['pipe', 'pipe', 'pipe'] // Explicitly typed
          : (options.stdio ?? 'pipe') // fallback to 'pipe'
      };

    try {
      // Create the child process
      const childProcess = execa(this.options.gitnestrPath, [command, ...args], commandOptions);
      this.activeProcesses.set(commandId, childProcess);

      // Handle stdout for progress events
      if (childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            const event: GitnestrEvent = {
              type: 'progress',
              command,
              message,
              progress: 0 // We don't have progress info from stdout
            };
            this.emit('event', event);
          }
        });
      }

      // Handle stderr for error events
      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          if (message) {
            const event: GitnestrEvent = {
              type: 'error',
              command,
              message
            };
            this.emit('event', event);
          }
        });
      }

      const result = await childProcess

      // Remove from active processes
      this.activeProcesses.delete(commandId);

      // Emit success event
      const successEvent: GitnestrEvent = {
        type: 'success',
        command,
        message: 'Command completed successfully',
        result
      };
      this.emit('event', successEvent);

      const execaErr = error as Partial<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;

      return {
        stdout: execaErr.stdout ?? '',
        stderr: execaErr.stderr ?? '',
        exitCode: execaErr.exitCode ?? 0,
        command: `${this.options.gitnestrPath} ${command} ${args.join(' ')}`
      };
    } catch (error: any) {
      // Remove from active processes
      this.activeProcesses.delete(commandId);

      // Handle timeout errors
      if (error.name === 'TimeoutError') {
        const timeoutEvent: GitnestrEvent = {
          type: 'error',
          command,
          message: `Command timed out after ${commandOptions.timeout}ms`,
          code: GitnestrErrorCode.TIMEOUT
        };
        this.emit('event', timeoutEvent);

        throw new GitnestrError(
          `Command timed out: ${command}`,
          GitnestrErrorCode.TIMEOUT,
          { command, args, timeout: commandOptions.timeout }
        );
      }

      // Handle command execution errors
      const errorEvent: GitnestrEvent = {
        type: 'error',
        command,
        message: error.message || 'Unknown error',
        code: GitnestrErrorCode.COMMAND_FAILED
      };
      this.emit('event', errorEvent);

      throw new GitnestrError(
        `Command failed: ${command}`,
        GitnestrErrorCode.COMMAND_FAILED,
        {
          command,
          args,
          exitCode: error.exitCode,
          stdout: error.stdout,
          stderr: error.stderr
        }
      );
    }
  }

  /**
   * Initialize a new gitnestr repository
   */
  async init(repoPath: string): Promise<GitnestrRepository> {
    const args = [repoPath];
    await this.executeCommand('init', args);
    return { path: repoPath };
  }

  /**
   * Clone a gitnestr repository
   */
  async clone(url: string, destPath?: string, branch?: string, keyAlias?: string): Promise<GitnestrRepository> {
    const args = [url];
    
    // Add branch if provided
    if (branch) {
      args.push(branch);
    }
    
    // If destPath is provided, use -C flag
    if (destPath) {
      // Extract the parent directory from the destPath
      const parentDir = path.dirname(destPath);
      
      // Ensure the parent directory exists
      fs.mkdirSync(parentDir, { recursive: true });
      
      // Use -C flag for the parent directory
      args.push('-C', parentDir);
    }
    
    if (keyAlias) {
      args.push('-a', keyAlias);
    }
    
    await this.executeCommand('clone', args);
    
    return { path: destPath || url.split('/').pop() || '' };
  }

  /**
   * Pull changes from a gitnestr repository
   */
  async pull(repoPath: string, branch?: string): Promise<GitnestrCommandResult> {
    const args = branch ? [branch] : [];
    return this.executeCommand('pull', args, { cwd: repoPath });
  }

  /**
   * Push changes to a gitnestr repository
   */
  async push(repoPath: string, privateKey?: string, keyAlias?: string): Promise<GitnestrCommandResult> {
    const args: string[] = [];
    
    if (privateKey) {
      args.push('-p', privateKey);
    }
    
    if (keyAlias) {
      args.push('-a', keyAlias);
    }
    
    return this.executeCommand('push', args, { cwd: repoPath });
  }

  /**
   * Fetch changes from a gitnestr repository without merging
   */
  async fetch(repoPath: string, branch?: string): Promise<GitnestrCommandResult> {
    const args: string[] = branch ? [branch] : [];
    return this.executeCommand('fetch', args, { cwd: repoPath });
  }

  /**
   * Retrieve archive DAG for a repository
   */
  async archive(url: string, branch?: string): Promise<string[]> {
    const args = [url];
    
    if (branch) {
      args.push(branch);
    }
    
    // Always request JSON output for easier parsing
    args.push('-j');
    
    const result = await this.executeCommand('archive', args);
    
    try {
      // Parse the JSON output
      return JSON.parse(result.stdout);
    } catch (e) {
      throw new GitnestrError(
        'Failed to parse archive output',
        GitnestrErrorCode.INTERNAL_ERROR,
        { stdout: result.stdout }
      );
    }
  }

  /**
   * Generate a new key pair
   */
  async generateKeys(): Promise<{ privateKey: string; publicKey: string }> {
    const result = await this.executeCommand('keys', ['generate']);
    
    // Parse the output to extract the keys
    const privateKeyMatch = result.stdout.match(/Private Key: (.+)/);
    const publicKeyMatch = result.stdout.match(/Public Key: (.+)/);
    
    if (!privateKeyMatch || !publicKeyMatch) {
      throw new GitnestrError(
        'Failed to parse key generation output',
        GitnestrErrorCode.INTERNAL_ERROR,
        { stdout: result.stdout }
      );
    }
    
    return {
      privateKey: privateKeyMatch[1],
      publicKey: publicKeyMatch[1]
    };
  }

  /**
   * Store a key with a passphrase
   */
  async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void> {
    await this.executeCommand('keys', ['update', '-a', alias, privateKey, passphrase]);
  }

  /**
   * Unlock a key with a passphrase
   */
  async unlockKey(alias: string, passphrase: string): Promise<string> {
    const result = await this.executeCommand('keys', ['unlock', '-a', alias, passphrase]);
    return result.stdout.trim();
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
   * Cancel all active processes
   */
  cancelAll(): void {
    for (const [id, process] of this.activeProcesses.entries()) {
      process.kill();
      this.activeProcesses.delete(id);
    }
  }
}
