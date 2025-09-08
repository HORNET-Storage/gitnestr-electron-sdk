const { execa } = await import('execa');
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { EventEmitter } from 'events';
import {
  GitnestrRepository,
  GitnestrCommandOptions,
  GitnestrCommandResult,
  GitnestrEvent,
  GitnestrEventListener,
  GitnestrError,
  GitnestrErrorCode,
  GitnestrBridgeOptions,
  DagMetadata,
  DagJsonOutput,
  ArchiveJsonOutput,
  PullRequestOptions,
  PullRequestResponse,
  PullRequestListItem,
  ListOptions,
  RepositoryListItem,
  PushEvent,
  ConfigOptions,
  ConfigItem
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

      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode ?? 0,
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
   * @param name The repository name
   * @param options Init options
   * @returns A promise that resolves with the repository info
   */
  async init(
    name: string,
    options: {
      repoPath?: string;
      alias?: string;
      privateKey?: string;
      nonInteractive?: boolean;
      silent?: boolean;
    } = {}
  ): Promise<GitnestrRepository> {
    const args = [name];

    if (options.repoPath) {
      args.push('-C', options.repoPath);
    }

    if (options.alias) {
      args.push('-a', options.alias);
    }

    if (options.privateKey) {
      args.push('-p', options.privateKey);
    }

    if (options.nonInteractive) {
      args.push('-n');
    }

    if (options.silent !== false) {
      args.push('-s');
    }

    await this.executeCommand('init', args);
    return { path: options.repoPath || name };
  }

  /**
   * Clone a gitnestr repository
   * @param url The repository URL
   * @param options Clone options
   * @returns A promise that resolves with the clone result
   */
  async clone(
    url: string,
    options: {
      destPath?: string;
      branch?: string;
      alias?: string;
      privateKey?: string;
      silent?: boolean;
    } = {}
  ): Promise<{ success: boolean; repository: GitnestrRepository; error?: string }> {
    try {
      const args = [url];

      // Add branch if provided
      if (options.branch) {
        args.push(options.branch);
      }

      // If destPath is provided, use -C flag
      if (options.destPath) {
        // Extract the parent directory from the destPath
        const parentDir = path.dirname(options.destPath);

        // Ensure the parent directory exists
        fsSync.mkdirSync(parentDir, { recursive: true });

        // Use -C flag for the parent directory
        args.push('-C', parentDir);
      }

      if (options.alias) {
        args.push('-a', options.alias);
      }

      if (options.privateKey) {
        args.push('-p', options.privateKey);
      }

      if (options.silent !== false) {
        args.push('-s');
      }

      await this.executeCommand('clone', args);

      return {
        success: true,
        repository: { path: options.destPath || url.split('/').pop() || '' }
      };
    } catch (error: any) {
      console.error('Clone error:', error);
      return {
        success: false,
        repository: { path: '' },
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Pull changes from a gitnestr repository
   * @param repoPath The path to the repository
   * @param options Pull options
   * @returns A promise that resolves with the command result
   */
  async pull(
    repoPath: string,
    options: {
      branch?: string;
      privateKey?: string;
      silent?: boolean;
    } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
     try {
      const args: string[] = [];

      if (options.branch) {
        args.push(options.branch);
      }

      if (options.privateKey) {
        args.push('-p', options.privateKey);
      }

      if (options.silent !== false) {
        args.push('-s');
      }

      const result = await this.executeCommand('pull', args, { cwd: repoPath });
      return {
        success: true,
        result
      };
    } catch (error: any) {
      console.error('Pull error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Push changes to a gitnestr repository
   * @param repoPath The path to the repository
   * @param options Push options
   * @returns A promise that resolves with the command result
   */
  async push(
    repoPath: string,
    options: {
      privateKey?: string;
      keyAlias?: string;
      force?: boolean;
      pullRequest?: string;
      tags?: boolean;
      skipVerification?: boolean;
      silent?: boolean;
    } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args: string[] = [];

      if (options.privateKey) {
        args.push('-p', options.privateKey);
      }

      if (options.keyAlias) {
        args.push('-a', options.keyAlias);
      }

      if (options.force) {
        args.push('-f');
      }

      if (options.pullRequest) {
        args.push('-r', options.pullRequest);
      }

      if (options.tags) {
        args.push('-t');
      }

      if (options.skipVerification) {
        args.push('--skip-verification');
      }

      if (options.silent !== false) {
        args.push('-s');
      }

      const result = await this.executeCommand('push', args, { cwd: repoPath });
      return {
        success: true,
        result
      };
    } catch (error: any) {
      console.error('Push error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Fetch changes from a gitnestr repository without merging
   * @param repoPath The path to the repository
   * @param options Fetch options
   * @returns A promise that resolves with the command result
   */
  async fetch(
    repoPath: string,
    options: {
      branch?: string;
      privateKey?: string;
      silent?: boolean;
    } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args: string[] = [];

      if (options.branch) {
        args.push(options.branch);
      }

      if (options.privateKey) {
        args.push('-p', options.privateKey);
      }

      if (options.silent !== false) {
        args.push('-s');
      }

      const result = await this.executeCommand('fetch', args, { cwd: repoPath });
      return {
        success: true,
        result
      };
    } catch (error: any) {
      console.error('Fetch error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Retrieve archive DAG for a repository
   * @param url The repository URL
   * @param branch Optional branch name
   * @param options Additional options
   * @returns A promise that resolves with the archive paths and status
   */
  async archive(
    url: string,
    branch?: string,
    options: {
      privateKey?: string;
      keyAlias?: string;
      jsonOutput?: boolean;
      silent?: boolean;
      repoPath?: string;
    } = {}
  ): Promise<{ success: boolean; result?: ArchiveJsonOutput; error?: string }> {
    const args = [url];

    if (branch) {
      args.push(branch);
    }

    if (options.privateKey) {
      args.push('-p', options.privateKey);
    }

    if (options.keyAlias) {
      args.push('-a', options.keyAlias);
    }

    if (options.repoPath) {
      args.push('-C', options.repoPath);
    }

    // Default to JSON output for programmatic use
    if (options.jsonOutput !== false) {
      args.push('-j');
    }

    if (options.silent !== false) {
      args.push('-s');
    }

    try {
      const result = await this.executeCommand('archive', args);

      if (options.jsonOutput !== false) {
        const archiveData: ArchiveJsonOutput = JSON.parse(result.stdout);
        return {
          success: true,
          result: archiveData
        };
      }

      return { success: true, result: undefined };
    } catch (error: any) {
      console.error('Archive error:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate a new key pair
   * @param keyAlias Optional key alias to use
   * @param passphrase Optional passphrase to automatically store the key
   * @returns A promise that resolves with the private and public keys (empty if stored directly)
   */
  async generateKeys(keyAlias?: string, passphrase?: string): Promise<{ privateKey: string; publicKey: string }> {
    const args = ['generate'];

    if (keyAlias) {
      args.push('-a', keyAlias);
    }

    if (passphrase) {
      args.push('-p', passphrase);
      // When passphrase is provided, keys are stored directly and not displayed
      await this.executeCommand('keys', args);
      return { privateKey: '', publicKey: '' }; // Keys are not returned when stored directly
    } else {
      const result = await this.executeCommand('keys', args);

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
   * Commit changes to a gitnestr repository
   * @param repoPath The path to the repository
   * @param message The commit message
   * @param options Commit options
   * @returns A promise that resolves with the command result
   */
  async commit(
    repoPath: string,
    message: string,
    options: {
      branch?: string;
      keepBranch?: boolean;
      silent?: boolean;
    } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args = [message];

      // Add branch flag if provided
      if (options.branch) {
        args.push('-b', options.branch);
      }

      if (options.keepBranch) {
        args.push('-k');
      }

      if (options.silent !== false) {
        args.push('-s');
      }

      const result = await this.executeCommand('commit', args, { cwd: repoPath });

      return {
        success: true,
        result
      };
    } catch (error: any) {
      console.error('Commit error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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

  /**
   * Download a DAG from a Hornet Storage relay
   * @param address The address of the relay
   * @param port The port of the relay
   * @param pubKey The public key of the relay
   * @param rootHash The root hash of the DAG to download
   * @param options Optional parameters for the download
   * @returns A promise that resolves with the command result
   */
  async download(
    address: string,
    port: string,
    pubKey: string,
    rootHash: string,
    options?: {
      fromLeaf?: number,
      toLeaf?: number,
      outputDir?: string,
      withContent?: boolean,
      jsonOutput?: boolean,
      jsonFile?: string
    }
  ): Promise<{ success: boolean; result?: DagJsonOutput; error?: string }> {
    const args = [address, port, pubKey, rootHash];

    if (options?.fromLeaf) args.push('--from', options.fromLeaf.toString());
    if (options?.toLeaf) args.push('--to', options.toLeaf.toString());
    if (options?.outputDir) args.push('--output', options.outputDir);
    if (options?.withContent === false) args.push('--content=false');
    if (options?.jsonOutput) args.push('--json');
    if (options?.jsonFile) args.push('--json-file', options.jsonFile);

    args.push('-j');

    args.push("--silent")

    try {
      const result = await this.executeCommand('download', args);

      const parsedResult: DagJsonOutput = JSON.parse(result.stdout);

      return {
        success: true,
        result: parsedResult
      };
    } catch (error: any) {
      console.error('Download error:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Revert the last bundle applied to the current branch
   * @param repoPath The path to the repository
   * @returns A promise that resolves with the command result
   */
  async revert(repoPath: string): Promise<GitnestrCommandResult> {
    return this.executeCommand('revert', [], { cwd: repoPath });
  }

  /**
   * Write a file to a repository
   * @param repoPath The path to the repository (pubkey/reponame)
   * @param filePath The path to the file, relative to the repository root
   * @param content The content to write to the file (string or Buffer)
   * @returns A promise that resolves with success status and message
   */
  async writeFile(repoPath: string, filePath: string, content: Buffer | string): Promise<{ success: boolean; message: string }> {
    try {
      // Normalize and resolve the full path (ensuring it's within the repo)
      const normalizedFilePath = path.normalize(filePath);

      // Check for directory traversal attempts
      if (normalizedFilePath.startsWith('..') || path.isAbsolute(normalizedFilePath)) {
        throw new Error('Invalid file path: Path must be relative to the repository root');
      }

      const fullPath = path.join(repoPath, normalizedFilePath);

      // Ensure the directory exists
      const directory = path.dirname(fullPath);
      await fs.mkdir(directory, { recursive: true });

      // Write the file
      await fs.writeFile(fullPath, content);

      // Emit success event
      const successEvent: GitnestrEvent = {
        type: 'success',
        command: 'writeFile',
        message: `File ${filePath} written successfully`
      };
      this.emit('event', successEvent);

      return { success: true, message: `File ${filePath} written successfully` };
    } catch (error: any) {
      // Emit error event
      const errorEvent: GitnestrEvent = {
        type: 'error',
        command: 'writeFile',
        message: error.message || 'Unknown error',
        code: GitnestrErrorCode.INTERNAL_ERROR
      };
      this.emit('event', errorEvent);

      throw new GitnestrError(
        `Failed to write file: ${filePath}`,
        GitnestrErrorCode.INTERNAL_ERROR,
        { repoPath, filePath, error: error.message }
      );
    }
  }

  /**
   * Create a pull request
   * @param repoPath The path to the repository
   * @param sourceBranch The source branch
   * @param targetBranch The target branch
   * @param options Pull request options
   * @returns A promise that resolves with the pull request response
   */
  async createPullRequest(
    repoPath: string,
    sourceBranch: string,
    targetBranch: string,
    options: PullRequestOptions = {}
  ): Promise<{ success: boolean; result?: PullRequestResponse; error?: string }> {
    try {
      const args = [sourceBranch, targetBranch];

      if (options.title) args.push('-t', options.title);
      if (options.description) args.push('-d', options.description);
      if (options.privateKey) args.push('-p', options.privateKey);
      if (options.keyAlias) args.push('-a', options.keyAlias);
      if (options.noEvent) args.push('--no-event');

      args.push("-j")
      args.push("--silent")

      const result = await this.executeCommand('pr', ['request', ...args], { cwd: repoPath });

      if (options.jsonOutput) {
        try {
          const jsonResponse = JSON.parse(result.stdout) as PullRequestResponse;
          return { success: true, result: jsonResponse };
        } catch (parseError) {
          return {
            success: false,
            error: `Failed to parse JSON response: ${parseError}`
          };
        }
      }

      return { success: true, result: undefined };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List pull requests for a repository
   * @param repoPath The path to the repository
   * @param options List options
   * @returns A promise that resolves with the pull request list
   */
  async listPullRequests(
    repoPath: string,
    relayUrl: string,
    options: ListOptions = {}
  ): Promise<{ success: boolean; result?: PullRequestListItem[]; error?: string }> {
    try {
      const args = [relayUrl];

      if (options.repo) args.push('-r', options.repo);
      if (options.pr) args.push('--pr');
      if (options.debug) args.push('-d');
      if (options.jsonOutput) args.push('-j');
      if (options.silent) args.push('-s');

      const result = await this.executeCommand('list', args, { cwd: repoPath });

      if (options.jsonOutput) {
        try {
          const jsonResponse = JSON.parse(result.stdout) as PullRequestListItem[];
          return { success: true, result: jsonResponse };
        } catch (parseError) {
          return {
            success: false,
            error: `Failed to parse JSON response: ${parseError}`
          };
        }
      }

      return { success: true, result: undefined };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Approve a pull request
   * @param repoPath The path to the repository
   * @param pullRequestId The pull request ID or bundle hash
   * @param options Additional options
   * @returns A promise that resolves with the command result
   */
  async approvePullRequest(
    repoPath: string,
    pullRequestId: string,
    options: { privateKey?: string; keyAlias?: string; silent?: boolean } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args = [pullRequestId];

      if (options.privateKey) args.push('-p', options.privateKey);
      if (options.keyAlias) args.push('-a', options.keyAlias);
      if (options.silent) args.push('-s');

      const result = await this.executeCommand('pr', ['approve', ...args], { cwd: repoPath });
      return { success: true, result };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Merge a pull request
   * @param repoPath The path to the repository
   * @param pullRequestId The pull request ID or bundle hash
   * @param options Additional options
   * @returns A promise that resolves with the command result
   */
  async mergePullRequest(
    repoPath: string,
    pullRequestId: string,
    options: { privateKey?: string; keyAlias?: string; silent?: boolean } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args = [pullRequestId];

      if (options.privateKey) args.push('-p', options.privateKey);
      if (options.keyAlias) args.push('-a', options.keyAlias);
      if (options.silent) args.push('-s');

      const result = await this.executeCommand('pr', ['merge', ...args], { cwd: repoPath });
      return { success: true, result };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Review a pull request
   * @param repoPath The path to the repository
   * @param pullRequestId The pull request ID or bundle hash
   * @param options Additional options
   * @returns A promise that resolves with the command result
   */
  async reviewPullRequest(
    repoPath: string,
    pullRequestEventId: string,
    options: { privateKey?: string; keyAlias?: string } = {}
  ): Promise<{ success: boolean; result?: GitnestrCommandResult; error?: string }> {
    try {
      const args = ['--event-id', pullRequestEventId];

      if (options.privateKey) args.push('-p', options.privateKey);
      if (options.keyAlias) args.push('-a', options.keyAlias);

      args.push("--silent")

      const result = await this.executeCommand('pr', ['review', ...args], { cwd: repoPath });
      return { success: true, result };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List repositories and branches
   * @param relayUrl The relay URL
   * @param options List options
   * @returns A promise that resolves with the repository list
   */
  async listRepositories(
    relayUrl: string,
    options: ListOptions = {}
  ): Promise<{ success: boolean; result?: RepositoryListItem[]; error?: string }> {
    try {
      const args = [relayUrl];

      if (options.repo) args.push('-r', options.repo);
      if (options.pushEvents) args.push('-p', options.pushEvents);
      if (options.debug) args.push('-d');
      if (options.jsonOutput) args.push('-j');
      if (options.silent) args.push('-s');

      const result = await this.executeCommand('list', args);

      if (options.jsonOutput) {
        try {
          const jsonResponse = JSON.parse(result.stdout) as RepositoryListItem[];
          return { success: true, result: jsonResponse };
        } catch (parseError) {
          return {
            success: false,
            error: `Failed to parse JSON response: ${parseError}`
          };
        }
      }

      return { success: true, result: undefined };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * List push events for a branch
   * @param relayUrl The relay URL
   * @param branch The branch name
   * @param options List options
   * @returns A promise that resolves with the push events
   */
  async listPushEvents(
    relayUrl: string,
    branch: string,
    options: ListOptions = {}
  ): Promise<{ success: boolean; result?: PushEvent[]; error?: string }> {
    try {
      const args = [relayUrl, '-p', branch];

      if (options.repo) args.push('-r', options.repo);
      if (options.debug) args.push('-d');
      if (options.jsonOutput) args.push('-j');
      if (options.silent) args.push('-s');

      const result = await this.executeCommand('list', args);

      if (options.jsonOutput) {
        try {
          const jsonResponse = JSON.parse(result.stdout) as PushEvent[];
          return { success: true, result: jsonResponse };
        } catch (parseError) {
          return {
            success: false,
            error: `Failed to parse JSON response: ${parseError}`
          };
        }
      }

      return { success: true, result: undefined };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get or set configuration values
   * @param options Configuration options
   * @returns A promise that resolves with the configuration result
   */
  async config(options: ConfigOptions): Promise<{ success: boolean; result?: ConfigItem[] | string; error?: string }> {
    try {
      const args: string[] = [];

      if (options.list) {
        args.push('--list');
      } else if (options.key && options.value) {
        args.push(options.key, options.value);
      } else if (options.key) {
        args.push(options.key);
      }

      if (options.global) args.push('--global');

      const result = await this.executeCommand('config', args);

      if (options.list) {
        // Parse config list output
        const lines = result.stdout.split('\n').filter(line => line.trim());
        const configItems: ConfigItem[] = lines.map(line => {
          const [key, ...valueParts] = line.split('=');
          return {
            key: key.trim(),
            value: valueParts.join('=').trim(),
            scope: options.global ? 'global' : 'local'
          };
        });
        return { success: true, result: configItems };
      } else if (options.key && !options.value) {
        // Getting a single value
        return { success: true, result: result.stdout.trim() };
      } else {
        // Setting a value
        return { success: true, result: undefined };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
