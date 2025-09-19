import { promises as fs } from 'fs';
import * as path from 'path';
import {
  GitRepository,
  FileChunk,
  TransferProgress,
  ValidationResult,
  GitBridgeError,
  GitErrorCode,
  GitBridgeOptions,
  TransferManifest,
  TransferComplete
} from './types';

const DEFAULT_OPTIONS: Required<GitBridgeOptions> = {
  maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024, // 1MB
  excludePatterns: ['node_modules/**'],
  includeGitHistory: true
};

export class GitBridge {
  private options: Required<GitBridgeOptions>;
  private repoBaseName: string;

  constructor(
    private repoPath: string,
    options: GitBridgeOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.repoBaseName = path.basename(this.repoPath);
  }

  async validateRepo(): Promise<ValidationResult> {
    try {
      // Check if path exists
      const stats = await fs.stat(this.repoPath);
      if (!stats.isDirectory()) {
        return {
          isValid: false,
          errors: ['Path is not a directory']
        };
      }

      // Check if it's a git repository by looking for .git directory
      const gitPath = path.join(this.repoPath, '.git');
      try {
        const gitStats = await fs.stat(gitPath);
        if (!gitStats.isDirectory()) {
          return {
            isValid: false,
            errors: ['Path is not a git repository']
          };
        }
      } catch {
        return {
          isValid: false,
          errors: ['Path is not a git repository']
        };
      }

      // Check repository size
      const size = await this.getRepoSize();
      if (size > this.options.maxRepoSize) {
        return {
          isValid: false,
          errors: [`Repository size (${size} bytes) exceeds maximum allowed size (${this.options.maxRepoSize} bytes)`]
        };
      }

      // Check permissions
      try {
        await fs.access(this.repoPath, fs.constants.R_OK);
      } catch {
        return {
          isValid: false,
          errors: ['Insufficient read permissions']
        };
      }

      return { isValid: true };
    } catch (error) {
      throw new GitBridgeError(
        'Failed to validate repository',
        GitErrorCode.INTERNAL_ERROR,
        { error }
      );
    }
  }

  async getMetadata(): Promise<GitRepository> {
    try {
      const size = await this.getRepoSize();
      const [branches, remotes, head] = await Promise.all([
        this.getBranches(),
        this.getRemotes(),
        this.getHead()
      ]);

      return {
        path: this.repoPath,
        size,
        branches,
        head,
        remotes
      };
    } catch (error) {
      throw new GitBridgeError(
        'Failed to get repository metadata',
        GitErrorCode.INTERNAL_ERROR,
        { error }
      );
    }
  }

  private async getBranches(): Promise<string[]> {
    const headsPath = path.join(this.repoPath, '.git', 'refs', 'heads');
    try {
      const branches = await this.readDirRecursive(headsPath);
      return branches.map(b => b.replace(/^refs\/heads\//, ''));
    } catch {
      return [];
    }
  }

  private async getRemotes(): Promise<string[]> {
    const remotesPath = path.join(this.repoPath, '.git', 'refs', 'remotes');
    try {
      const remotes = await fs.readdir(remotesPath);
      return remotes.filter(r => r !== 'HEAD');
    } catch {
      return [];
    }
  }

  private async getHead(): Promise<string> {
    try {
      const headPath = path.join(this.repoPath, '.git', 'HEAD');
      const head = await fs.readFile(headPath, 'utf8');
      return head.trim().replace('ref: ', '');
    } catch {
      return '';
    }
  }

  private async readDirRecursive(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const subResults = await this.readDirRecursive(fullPath);
          results.push(...subResults);
        } else {
          results.push(file);
        }
      }
    } catch {
      // Ignore errors and return what we have
    }
    return results;
  }

  async *streamRepository(): AsyncGenerator<FileChunk | { manifest: TransferManifest } | TransferComplete, void, unknown> {
    const validation = await this.validateRepo();
    if (!validation.isValid) {
      throw new GitBridgeError(
        'Invalid repository',
        GitErrorCode.INVALID_REPOSITORY,
        { errors: validation.errors }
      );
    }

    try {
      const files = await this.listFiles();

      // First yield the manifest with relative paths
      yield {
        manifest: {
          totalFiles: files.length,
          files: files.map(file => this.makeRelativePath(file))
        }
      };

      // Then stream the files
      for (const file of files) {
        const filePath = path.join(this.repoPath, file);
        const fileHandle = await fs.open(filePath, 'r');
        const stats = await fileHandle.stat();
        const totalChunks = Math.ceil(stats.size / this.options.chunkSize);
        let chunkIndex = 0;

        try {
          while (true) {
            const buffer = Buffer.alloc(this.options.chunkSize);
            const { bytesRead } = await fileHandle.read(
              buffer,
              0,
              buffer.length,
              chunkIndex * this.options.chunkSize
            );

            if (bytesRead === 0) break;

            yield {
              index: chunkIndex++,
              totalChunks,
              data: buffer.slice(0, bytesRead),
              path: this.makeRelativePath(file)
            };
          }
        } finally {
          await fileHandle.close();
        }
      }

      yield { complete: true };
    } catch (error) {
      throw new GitBridgeError(
        'Failed to stream repository',
        GitErrorCode.TRANSFER_ERROR,
        { error }
      );
    }
  }

  private makeRelativePath(filePath: string): string {
    // Convert Windows backslashes to forward slashes
    return filePath.replace(/\\/g, '/');
  }

  private async getRepoSize(): Promise<number> {
    let size = 0;
    const files = await this.listFiles();

    for (const file of files) {
      const stats = await fs.stat(path.join(this.repoPath, file));
      size += stats.size;
    }

    return size;
  }

  private async listFiles(): Promise<string[]> {
    const results: string[] = [];
    await this.listFilesRecursive(this.repoPath, '', results);
    return results.filter(file =>
      !this.options.excludePatterns.some(pattern => this.matchGlobPattern(file, pattern))
    );
  }

  private async listFilesRecursive(basePath: string, relativePath: string, results: string[]): Promise<void> {
    const currentPath = path.join(basePath, relativePath);
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelativePath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') {
          await this.listFilesRecursive(basePath, entryRelativePath, results);
        }
      } else {
        results.push(entryRelativePath.replace(/\\/g, '/'));
      }
    }
  }

  private matchGlobPattern(filePath: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${regexPattern}$`).test(filePath);
  }
}
