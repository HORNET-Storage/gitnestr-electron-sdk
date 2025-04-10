# @gitnestr/electron-git-bridge

The Electron (main process) component of the Gitnestr SDK, responsible for reading Git repositories from the filesystem and streaming them to the renderer process.

## Installation

```bash
npm install @gitnestr/electron-git-bridge
```

## Usage

```typescript
import { GitBridge } from '@gitnestr/electron-git-bridge';

// Initialize with repository path
const bridge = new GitBridge('/path/to/repository', {
  maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024, // 1MB
  excludePatterns: ['node_modules/**'],
  includeGitHistory: true
});

// Validate repository
const validation = await bridge.validateRepo();
if (!validation.isValid) {
  console.error('Invalid repository:', validation.errors);
  return;
}

// Get repository metadata
const metadata = await bridge.getMetadata();
console.log('Repository info:', {
  path: metadata.path,
  size: metadata.size,
  branches: metadata.branches,
  head: metadata.head,
  remotes: metadata.remotes
});

// Stream repository to renderer
for await (const chunk of bridge.streamRepository()) {
  if ('manifest' in chunk) {
    // Send manifest first
    mainWindow.webContents.send('repo-metadata', {
      ...metadata,
      manifest: chunk.manifest
    });
  } else {
    // Send file chunks
    mainWindow.webContents.send('repo-chunk', chunk);
  }
}
```

## API Reference

### Constructor

```typescript
constructor(repoPath: string, options?: GitBridgeOptions)
```

Creates a new GitBridge instance.

- `repoPath`: Path to the Git repository on disk
- `options`: Optional configuration object

### Options

```typescript
interface GitBridgeOptions {
  maxRepoSize?: number;      // Maximum repository size (default: 1GB)
  chunkSize?: number;        // Size of transfer chunks (default: 1MB)
  excludePatterns?: string[]; // Glob patterns to exclude (default: ['node_modules/**'])
  includeGitHistory?: boolean; // Include .git directory (default: true)
}
```

### Methods

#### validateRepo

```typescript
async validateRepo(): Promise<ValidationResult>
```

Validates the repository path and checks:
- Directory exists
- Is a Git repository
- Size within limits
- Read permissions

Returns:
```typescript
interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}
```

#### getMetadata

```typescript
async getMetadata(): Promise<GitRepository>
```

Gets repository metadata including:
- Repository path
- Total size
- Branches
- HEAD reference
- Remote configurations

Returns:
```typescript
interface GitRepository {
  path: string;
  size: number;
  branches: string[];
  head: string;
  remotes: string[];
}
```

#### streamRepository

```typescript
async *streamRepository(): AsyncGenerator<FileChunk | { manifest: TransferManifest }>
```

Streams the repository content as chunks. Yields:
1. First, a manifest containing file list
2. Then, file chunks for each file

Types:
```typescript
interface TransferManifest {
  totalFiles: number;
  files: string[];
}

interface FileChunk {
  index: number;
  totalChunks: number;
  data: Uint8Array;
  path: string;
}
```

## Error Handling

The package uses the `GitBridgeError` class for error handling:

```typescript
try {
  await bridge.validateRepo();
} catch (error) {
  if (error instanceof GitBridgeError) {
    console.error('Error code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
  }
}
```

Error codes:
- `INVALID_REPOSITORY`: Repository validation failed
- `TRANSFER_ERROR`: Error during file transfer
- `INTERNAL_ERROR`: Unexpected internal error

## Example

See the `example` directory in the root package for a complete working example.
