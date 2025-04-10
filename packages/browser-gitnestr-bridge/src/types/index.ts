export interface GitnestrRepository {
  path: string;
  origin?: string;
  branch?: string;
}

export interface GitnestrCommandOptions {
  timeout?: number;
  env?: Record<string, string>;
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
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  IPC_ERROR = 'IPC_ERROR'
}

export interface RepositoryInfo {
  id: string;
  name: string;
  author: string;
  description?: string;
  permissions: string[];
  cloneUrl: string;
}

export interface BrowserGitnestrBridgeOptions {
  timeout?: number;
  relays?: string[];
}

export interface IPCRequest {
  id: string;
  method: string;
  params: any[];
}

export interface IPCResponse {
  id: string;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface IPCEventMessage {
  type: 'event';
  event: GitnestrEvent;
}

export type IPCMessage = IPCResponse | IPCEventMessage;
