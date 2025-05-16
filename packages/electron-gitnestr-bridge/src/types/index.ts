export interface GitnestrRepository {
  path: string;
  origin?: string;
  branch?: string;
}

export interface GitnestrCommandOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<any>;
}

export interface GitnestrCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export interface GitnestrProgressEvent {
  type: 'progress';
  command: string;
  message: string;
  progress: number;
}

export interface GitnestrErrorEvent {
  type: 'error';
  command: string;
  message: string;
  code?: string;
}

export interface GitnestrSuccessEvent {
  type: 'success';
  command: string;
  message: string;
  result?: any;
}

export type GitnestrEvent = GitnestrProgressEvent | GitnestrErrorEvent | GitnestrSuccessEvent;

export interface GitnestrEventListener {
  (event: GitnestrEvent): void;
}

export class GitnestrError extends Error {
  constructor(
    message: string,
    public code: GitnestrErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GitnestrError';
  }
}

export enum GitnestrErrorCode {
  COMMAND_FAILED = 'COMMAND_FAILED',
  TIMEOUT = 'TIMEOUT',
  INVALID_REPOSITORY = 'INVALID_REPOSITORY',
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export interface RepositoryInfo {
  id: string;
  name: string;
  author: string;
  description?: string;
  permissions: string[];
  cloneUrl: string;
}

export interface GitnestrBridgeOptions {
  gitnestrPath?: string;
  timeout?: number;
  env?: Record<string, string>;
  relays?: string[];
}

export interface GitnestrDownloadCommandResponse {
  meta: DagMetadata;
  files: FileDetails[];
}

export interface DagMetadata {
  root_hash: string;
  total_leaves: number;
  type: string;
  name?: string;
  timestamp?: string; // ISO8601 string
}

export interface FileDetails {
  path: string;
  hash: string;
  type: 'file' | 'directory';
  size?: number;
  content_base64?: string;
  leaf_range: LeafRange;
}

export interface LeafRange {
  from: number;
  to: number;
}
