import { 
  FileChunk, 
  GitRepository, 
  GitBridgeError, 
  GitErrorCode, 
  BrowserGitBridgeOptions,
  TransferManifest,
  FileTransfer
} from './types';
import FS from '@isomorphic-git/lightning-fs';
import * as git from 'isomorphic-git';

const DEFAULT_OPTIONS: Required<BrowserGitBridgeOptions> = {
  fsName: 'F:\\organizations\\hornet-storage\\golang\\gitnestr_combined\\gitnestr\\gitnestr.exe',
  maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024, // 1MB
  cacheSize: 100 * 1024 * 1024, // 100MB
  persistCache: true
};

export class BrowserGitBridge {
  private fs: FS;
  private options: Required<BrowserGitBridgeOptions>;
  private currentTransfer: Map<string, FileTransfer> = new Map();
  private _transferManifest?: TransferManifest;
  private transferComplete = false;
  
  // Getter for transferManifest
  get transferManifest(): TransferManifest | undefined {
    return this._transferManifest;
  }

  constructor(options: BrowserGitBridgeOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    // Initialize LightningFS with default options
    this.fs = new FS(this.options.fsName);
  }

  async init(): Promise<void> {
    try {
      // Clear any existing data
      await this.fs.promises.unlink('/').catch(() => {});
      await this.fs.promises.mkdir('/').catch(() => {});
      // Reset transfer state
      this.currentTransfer.clear();
      this._transferManifest = undefined;
      this.transferComplete = false;
    } catch (error) {
      console.error('Error initializing:', error);
    }
  }

  setTransferManifest(manifest: TransferManifest): void {
    this._transferManifest = manifest;
    this.transferComplete = false;
    this.currentTransfer.clear();
  }

  isTransferComplete(): boolean {
    if (!this._transferManifest) return false;
    
    // Check if we've received all expected files
    for (const filePath of this._transferManifest.files) {
      const transfer = this.currentTransfer.get(filePath);
      if (!transfer || !transfer.isComplete) {
        return false;
      }
    }
    
    this.transferComplete = true;
    return true;
  }

  async verifyTransfer(): Promise<{ success: boolean; errors: string[] }> {
    if (!this._transferManifest) {
      return { success: false, errors: ['No transfer manifest available'] };
    }

    if (!this.transferComplete) {
      return { success: false, errors: ['Transfer is not complete'] };
    }

    const errors: string[] = [];
    
    for (const filePath of this._transferManifest.files) {
      try {
        const normalizedPath = this.normalizePath(filePath);
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

  async initializeRepo(repoPath: string): Promise<void> {
    try {
      // Create root directory if it doesn't exist
      try {
        await this.fs.promises.mkdir('/');
      } catch (error) {
        console.log('Root directory already exists');
      }

      console.log('Repository initialized at root');
    } catch (error) {
      console.error('Failed to initialize repository:', error);
      throw new GitBridgeError(
        'Failed to initialize repository',
        GitErrorCode.INTERNAL_ERROR,
        { error }
      );
    }
  }

  private normalizePath(filePath: string): string {
    // Remove any leading slash
    let normalizedPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    
    // Ensure proper path separators
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    
    // Remove any double slashes
    normalizedPath = normalizedPath.replace(/\/+/g, '/');
    
    // Add leading slash back
    return '/' + normalizedPath;
  }

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

  async receiveChunk(chunk: FileChunk): Promise<void> {
    try {
      const existingTransfer = this.currentTransfer.get(chunk.path);
      const transfer: FileTransfer = existingTransfer || {
        chunks: new Map(),
        totalChunks: chunk.totalChunks,
        receivedChunks: 0,
        isComplete: false
      };

      if (!existingTransfer) {
        this.currentTransfer.set(chunk.path, transfer);
      }

      transfer.chunks.set(chunk.index, chunk.data);
      transfer.receivedChunks++;

      // Check if we have all chunks for this file
      if (transfer.receivedChunks === transfer.totalChunks) {
        await this.writeFile(chunk.path, transfer.chunks);
        transfer.isComplete = true;
      }
    } catch (error) {
      console.error('Error in receiveChunk:', {
        error,
        chunk,
        currentTransfer: this.currentTransfer.get(chunk.path)
      });
      throw new GitBridgeError(
        `Failed to receive chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
        GitErrorCode.TRANSFER_ERROR,
        { error, chunk }
      );
    }
  }

  private async writeFile(filePath: string, chunks: Map<number, Uint8Array>): Promise<void> {
    try {
      // Normalize the file path
      const normalizedPath = this.normalizePath(filePath);
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
        dirPath: filePath.substring(0, filePath.lastIndexOf('/')),
        chunksCount: chunks.size
      });
      throw new GitBridgeError(
        `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        GitErrorCode.INTERNAL_ERROR,
        { error, filePath }
      );
    }
  }

  async getRepository(path: string): Promise<GitRepository> {
    try {
      const [branches, remotes, head] = await Promise.all([
        this.getBranches(),
        this.getRemotes(),
        this.getHead()
      ]);

      const size = await this.getRepoSize();

      return {
        path: '/',
        size,
        branches,
        head,
        remotes
      };
    } catch (error) {
      throw new GitBridgeError(
        'Failed to get repository information',
        GitErrorCode.INTERNAL_ERROR,
        { error }
      );
    }
  }

  private async getBranches(): Promise<string[]> {
    try {
      console.log('Getting branches');
      const refs = await git.listBranches({ fs: this.fs, dir: '/' });
      console.log('Found branches:', refs);
      return refs;
    } catch (error) {
      console.error('Error getting branches:', error);
      return [];
    }
  }

  private async getRemotes(): Promise<string[]> {
    try {
      console.log('Getting remotes');
      const config = await git.listRemotes({ fs: this.fs, dir: '/' });
      console.log('Found remotes:', config);
      return config.map(remote => remote.remote);
    } catch (error) {
      console.error('Error getting remotes:', error);
      return [];
    }
  }

  private async getHead(): Promise<string> {
    try {
      console.log('Getting HEAD');
      const head = await git.resolveRef({ fs: this.fs, dir: '/', ref: 'HEAD' });
      console.log('Found HEAD:', head);
      return head;
    } catch (error) {
      console.error('Error getting HEAD:', error);
      return '';
    }
  }

  private async getRepoSize(dirPath: string = '/'): Promise<number> {
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
}
