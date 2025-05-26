export interface RepositoryId {
  ownerPubkey: string;
  repoName: string;
}

export interface GitRepository {
  path: string;
  size: number;
  branches: string[];
  head: string;
  remotes: string[];
}

export interface FileChunk {
  path: string;
  index: number;
  totalChunks: number;
  data: Uint8Array;
}

export interface TransferManifest {
  totalFiles: number;
  files: string[];
}

export interface FileTransfer {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
  receivedChunks: number;
  isComplete: boolean;
}

export interface TransferProgress {
  filesProcessed: number;
  totalFiles: number;
  currentFile: string;
  bytesProcessed: number;
  totalBytes: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
}

export class GitBridgeError extends Error {
  constructor(
    message: string,
    public code: GitErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GitBridgeError';
  }
}

export enum GitErrorCode {
  INVALID_REPOSITORY = 'INVALID_REPOSITORY',
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  SIZE_LIMIT_EXCEEDED = 'SIZE_LIMIT_EXCEEDED',
  TRANSFER_ERROR = 'TRANSFER_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export interface BrowserGitBridgeOptions {
  fsName?: string;
  maxRepoSize?: number; // in bytes
  chunkSize?: number; // in bytes
  cacheSize?: number; // in bytes
  persistCache?: boolean;
}
