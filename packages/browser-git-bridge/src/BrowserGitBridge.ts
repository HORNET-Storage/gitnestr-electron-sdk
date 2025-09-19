import {
  FileChunk,
  GitRepository,
  GitBridgeError,
  GitErrorCode,
  BrowserGitBridgeOptions,
  TransferManifest,
  TransferComplete,
  FileTransfer,
  RepositoryId
} from './types';
import FS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';

const DEFAULT_OPTIONS: Required<BrowserGitBridgeOptions> = {
  fsName: 'gitnestr',
   maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024, // 1MB
  cacheSize: 100 * 1024 * 1024, // 100MB
  persistCache: true
};

export class BrowserGitBridge {
  private fs: FS;
  private options: Required<BrowserGitBridgeOptions>;
  private currentTransfers: Map<string, Map<string, FileTransfer>> = new Map();
  private transferManifests: Map<string, TransferManifest> = new Map();
  private pendingWrites: Map<string, Promise<void>[]> = new Map();
  private transferCompleteResolvers: Map<string, () => void> = new Map();
  private transferCompletePromises: Map<string, Promise<void>> = new Map();

  constructor(options: BrowserGitBridgeOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    // Initialize LightningFS with default options
    this.fs = new FS(this.options.fsName);
  }

  /**
   * Get the underlying LightningFS instance
   * @returns The LightningFS instance used by this bridge
   */
  getFileSystem(): FS {
    return this.fs;
  }

  /**
   * Get the repository base path
   */
  private getRepoPath(repoId: RepositoryId): string {
    return `/${repoId.ownerPubkey}:${repoId.repoName}`;
  }

  /**
   * Get a unique key for a repository
   */
  private getRepoKey(repoId: RepositoryId): string {
    return `${repoId.ownerPubkey}:${repoId.repoName}`;
  }

  /**
   * Normalize a file path within a repository
   */
  private normalizeRepoPath(filePath: string, repoId: RepositoryId): string {
    const repoBase = this.getRepoPath(repoId);

    // Remove any leading slash from the file path
    let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;

    // Ensure proper path separators
    normalizedPath = normalizedPath.replace(/\\/g, '/');

    // Remove any double slashes
    normalizedPath = normalizedPath.replace(/\/+/g, '/');

    // Combine repo base with file path
    return `${repoBase}/${normalizedPath}`;
  }

  /**
   * Initialize a repository
   */
  async initializeRepo(repoId: RepositoryId): Promise<void> {
    try {
      const repoPath = this.getRepoPath(repoId);

      // Create repository directory
      await this.ensureDir(repoPath);

      // Initialize transfer tracking for this repository
      const repoKey = this.getRepoKey(repoId);
      this.currentTransfers.set(repoKey, new Map());
      this.pendingWrites.set(repoKey, []);

      // Create a completion promise for this transfer
      const completePromise = new Promise<void>((resolve) => {
        this.transferCompleteResolvers.set(repoKey, resolve);
      });
      this.transferCompletePromises.set(repoKey, completePromise);

      console.log(`Repository initialized at ${repoPath}`);
    } catch (error) {
      console.error('Failed to initialize repository:', error);
      throw new GitBridgeError(
        'Failed to initialize repository',
        GitErrorCode.INTERNAL_ERROR,
        { error, repoId }
      );
    }
  }

  /**
   * Set transfer manifest for a specific repository
   */
  setTransferManifest(manifest: TransferManifest, repoId: RepositoryId): void {
    const repoKey = this.getRepoKey(repoId);
    this.transferManifests.set(repoKey, manifest);

    // Clear existing transfers for this repository
    this.currentTransfers.set(repoKey, new Map());
  }

  /**
   * Wait for all pending writes to complete
   */
  async waitForPendingWrites(repoId: RepositoryId): Promise<void> {
    const repoKey = this.getRepoKey(repoId);
    const writes = this.pendingWrites.get(repoKey) || [];

    if (writes.length > 0) {
      console.log(`Waiting for ${writes.length} pending writes to complete...`);
      await Promise.all(writes);
      console.log('All pending writes completed');
    }
  }

  /**
   * Mark transfer as complete for a specific repository
   */
  async markTransferComplete(repoId: RepositoryId): Promise<void> {
    const repoKey = this.getRepoKey(repoId);

    // Wait for all pending writes to complete
    await this.waitForPendingWrites(repoId);

    console.log(`Transfer marked complete for repository ${repoKey}`);

    // Resolve the completion promise
    const resolver = this.transferCompleteResolvers.get(repoKey);
    if (resolver) {
      resolver();
    }
  }

  /**
   * Wait for transfer to complete
   */
  async waitForTransferComplete(repoId: RepositoryId): Promise<void> {
    const repoKey = this.getRepoKey(repoId);
    const promise = this.transferCompletePromises.get(repoKey);
    if (promise) {
      await promise;
    }
  }

  /**
   * Handle transfer completion signal
   */
  handleTransferComplete(completion: TransferComplete, repoId: RepositoryId): void {
    if (completion.complete) {
      this.markTransferComplete(repoId);
    }
  }

  /**
   * Check if transfer is complete for a specific repository
   */
  isTransferComplete(repoId: RepositoryId): boolean {
    const repoKey = this.getRepoKey(repoId);
    const manifest = this.transferManifests.get(repoKey);
    const transfers = this.currentTransfers.get(repoKey);

    if (!manifest || !transfers) return false;

    // Check if we've received all expected files
    for (const filePath of manifest.files) {
      const transfer = transfers.get(filePath);
      if (!transfer || !transfer.isComplete) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verify transfer for a specific repository
   */
  async verifyTransfer(repoId: RepositoryId): Promise<{ success: boolean; errors: string[] }> {
    const repoKey = this.getRepoKey(repoId);
    const manifest = this.transferManifests.get(repoKey);

    if (!manifest) {
      return { success: false, errors: ['No transfer manifest available'] };
    }

    // Wait for all pending writes to complete before verification
    await this.waitForPendingWrites(repoId);

    if (!this.isTransferComplete(repoId)) {
      return { success: false, errors: ['Transfer is not complete'] };
    }

    const errors: string[] = [];

    for (const filePath of manifest.files) {
      try {
        const normalizedPath = this.normalizeRepoPath(filePath, repoId);
        // Check if file exists
        const stats = await this.fs.promises.stat(normalizedPath);
        if (!stats.isFile()) {
          errors.push(`${filePath} exists but is not a file`);
          continue;
        }

        // Try to read the file to verify it's accessible
        try {
          await this.fs.promises.readFile(normalizedPath);
        } catch (readError) {
          errors.push(`${filePath} exists but cannot be read: ${readError instanceof Error ? readError.message : 'Unknown error'}`);
        }
      } catch (error) {
        errors.push(`Failed to verify ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(dirPath: string): Promise<void> {
    if (dirPath === '/') return;

    const parts = dirPath.split('/').filter(Boolean);
    let currentPath = '/';

    for (const part of parts) {
      currentPath = `${currentPath}${part}`;
      try {
        await this.fs.promises.mkdir(currentPath);
      } catch (error) {
        // Ignore directory exists error
        if ((error as any)?.code !== 'EEXIST') {
          throw error;
        }
      }
      currentPath += '/';
    }
  }

  /**
   * Receive a file chunk for a specific repository
   */
  async receiveChunk(chunk: FileChunk, repoId: RepositoryId): Promise<void> {
    try {
      const repoKey = this.getRepoKey(repoId);
      let transfers = this.currentTransfers.get(repoKey);

      if (!transfers) {
        transfers = new Map();
        this.currentTransfers.set(repoKey, transfers);
      }

      const existingTransfer = transfers.get(chunk.path);
      const transfer: FileTransfer = existingTransfer || {
        chunks: new Map(),
        totalChunks: chunk.totalChunks,
        receivedChunks: 0,
        isComplete: false
      };

      if (!existingTransfer) {
        transfers.set(chunk.path, transfer);
      }

      transfer.chunks.set(chunk.index, chunk.data);
      transfer.receivedChunks++;

      // Check if we have all chunks for this file
      if (transfer.receivedChunks === transfer.totalChunks) {
        // Track the write operation as a promise
        const repoKey = this.getRepoKey(repoId);
        const pendingWrites = this.pendingWrites.get(repoKey) || [];

        const writePromise = this.writeFile(chunk.path, transfer.chunks, repoId)
          .then(() => {
            transfer.isComplete = true;
            console.log(`File ${chunk.path} write completed`);
          })
          .catch((error) => {
            console.error(`Error writing file ${chunk.path}:`, error);
            throw error;
          });

        pendingWrites.push(writePromise);
        this.pendingWrites.set(repoKey, pendingWrites);
      }
    } catch (error) {
      console.error('Error in receiveChunk:', {
        error,
        chunk,
        repoId
      });
      throw new GitBridgeError(
        `Failed to receive chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
        GitErrorCode.TRANSFER_ERROR,
        { error, chunk, repoId }
      );
    }
  }

  /**
   * Write a complete file from chunks
   */
  private async writeFile(filePath: string, chunks: Map<number, Uint8Array>, repoId: RepositoryId): Promise<void> {
    try {
      // Normalize the file path within the repository
      const normalizedPath = this.normalizeRepoPath(filePath, repoId);
      console.log('Writing file:', normalizedPath);

      // Create directory structure if needed
      const dirPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
      await this.ensureDir(dirPath);

      // Combine chunks in order
      const sortedChunks = Array.from(chunks.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, data]) => data);

      const totalLength = sortedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fileData = new Uint8Array(totalLength);

      let offset = 0;
      for (const chunk of sortedChunks) {
        fileData.set(chunk, offset);
        offset += chunk.length;
      }

      // Write the complete file
      await this.fs.promises.writeFile(normalizedPath, fileData);
      console.log('File written successfully:', normalizedPath);
    } catch (error) {
      console.error('Error writing file:', {
        error,
        filePath,
        repoId
      });
      throw new GitBridgeError(
        `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        GitErrorCode.INTERNAL_ERROR,
        { error, filePath, repoId }
      );
    }
  }

  /**
   * Get repository information
   */
  async getRepository(repoId: RepositoryId): Promise<GitRepository> {
    try {
      const repoPath = this.getRepoPath(repoId);

      // Check if repository exists
      try {
        await this.fs.promises.stat(repoPath);
      } catch (error) {
        throw new GitBridgeError(
          'Repository not found',
          GitErrorCode.REPOSITORY_NOT_FOUND,
          { repoId }
        );
      }

      const [branches, remotes, head] = await Promise.all([
        this.getBranches(repoId),
        this.getRemotes(repoId),
        this.getHead(repoId)
      ]);

      const size = await this.getRepoSize(repoPath);

      return {
        path: repoPath,
        size,
        branches,
        head,
        remotes
      };
    } catch (error) {
      if (error instanceof GitBridgeError) throw error;

      throw new GitBridgeError(
        'Failed to get repository information',
        GitErrorCode.INTERNAL_ERROR,
        { error, repoId }
      );
    }
  }

  /**
   * Get branches for a repository
   */
  private async getBranches(repoId: RepositoryId): Promise<string[]> {
    try {
      const repoPath = this.getRepoPath(repoId);
      console.log('Getting branches for', repoPath);
      const refs = await git.listBranches({ fs: this.fs, dir: repoPath });
      console.log('Found branches:', refs);
      return refs;
    } catch (error) {
      console.error('Error getting branches:', error);
      return [];
    }
  }

  /**
   * Get remotes for a repository
   */
  private async getRemotes(repoId: RepositoryId): Promise<string[]> {
    try {
      const repoPath = this.getRepoPath(repoId);
      console.log('Getting remotes for', repoPath);
      const config = await git.listRemotes({ fs: this.fs, dir: repoPath });
      console.log('Found remotes:', config);
      return config.map(remote => remote.remote);
    } catch (error) {
      console.error('Error getting remotes:', error);
      return [];
    }
  }

  /**
   * Get HEAD for a repository
   */
  private async getHead(repoId: RepositoryId): Promise<string> {
    try {
      const repoPath = this.getRepoPath(repoId);
      console.log('Getting HEAD for', repoPath);
      const head = await git.resolveRef({ fs: this.fs, dir: repoPath, ref: 'HEAD' });
      console.log('Found HEAD:', head);
      return head;
    } catch (error) {
      console.error('Error getting HEAD:', error);
      return '';
    }
  }

  /**
   * Get repository size
   */
  private async getRepoSize(dirPath: string): Promise<number> {
    try {
      let size = 0;
      const files = await this.fs.promises.readdir(dirPath);

      for (const file of files) {
        const filePath = dirPath === '/' ? `/${file}` : `${dirPath}/${file}`;
        const stats = await this.fs.promises.stat(filePath);
        if (stats.type === 'dir') {
          size += await this.getRepoSize(filePath);
        } else {
          size += stats.size;
        }
      }

      return size;
    } catch (error) {
      console.error('Error getting repository size:', error);
      return 0;
    }
  }

  /**
   * List all repositories
   */
  async listRepositories(): Promise<RepositoryId[]> {
    try {
      const repositories: RepositoryId[] = [];
      const entries = await this.fs.promises.readdir('/');

      for (const entry of entries) {
        // Check if entry matches the pattern "ownerPubkey:repoName"
        const match = entry.match(/^([^:]+):(.+)$/);
        if (match) {
          repositories.push({
            ownerPubkey: match[1],
            repoName: match[2]
          });
        }
      }

      return repositories;
    } catch (error) {
      console.error('Error listing repositories:', error);
      return [];
    }
  }

  /**
   * Check if a repository exists
   */
  async repositoryExists(repoId: RepositoryId): Promise<boolean> {
    try {
      const repoPath = this.getRepoPath(repoId);
      await this.fs.promises.stat(repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a repository
   */
  async deleteRepository(repoId: RepositoryId): Promise<void> {
    try {
      const repoPath = this.getRepoPath(repoId);
      const repoKey = this.getRepoKey(repoId);

      // Remove from tracking
      this.currentTransfers.delete(repoKey);
      this.transferManifests.delete(repoKey);
      this.pendingWrites.delete(repoKey);
      this.transferCompleteResolvers.delete(repoKey);
      this.transferCompletePromises.delete(repoKey);

      // Delete directory recursively
      await this.deleteDirectory(repoPath);

      console.log(`Repository deleted: ${repoPath}`);
    } catch (error) {
      throw new GitBridgeError(
        'Failed to delete repository',
        GitErrorCode.INTERNAL_ERROR,
        { error, repoId }
      );
    }
  }

  /**
   * Delete a directory recursively
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await this.fs.promises.readdir(dirPath);

      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry}`;
        const stats = await this.fs.promises.stat(entryPath);

        if (stats.type === 'dir') {
          await this.deleteDirectory(entryPath);
        } else {
          await this.fs.promises.unlink(entryPath);
        }
      }

      await this.fs.promises.rmdir(dirPath);
    } catch (error) {
      console.error('Error deleting directory:', error);
      throw error;
    }
  }

  /**
   * Clear all data (for backwards compatibility or testing)
   */
  async init(): Promise<void> {
    try {
      // Clear all repositories
      const repositories = await this.listRepositories();
      for (const repoId of repositories) {
        await this.deleteRepository(repoId);
      }

      // Clear all tracking
      this.currentTransfers.clear();
      this.transferManifests.clear();
      this.pendingWrites.clear();
      this.transferCompleteResolvers.clear();
      this.transferCompletePromises.clear();

      console.log('All repositories cleared');
    } catch (error) {
      console.error('Error initializing:', error);
    }
  }
}
