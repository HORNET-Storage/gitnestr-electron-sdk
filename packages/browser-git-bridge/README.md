# @gitnestr/browser-git-bridge

The renderer (browser) component of the Gitnestr SDK, responsible for receiving Git repositories from the main process and managing them in an in-memory filesystem using LightningFS and isomorphic-git.

## Installation

```bash
npm install @gitnestr/browser-git-bridge
```

## Usage

### Multi-Repository Support

The bridge now supports managing multiple repositories in a single filesystem instance, with each repository stored at `/<ownerPubkey>:<repoName>/`.

```typescript
import { BrowserGitBridge, RepositoryId } from '@gitnestr/browser-git-bridge';

// Initialize the bridge
const bridge = new BrowserGitBridge({
  fsName: 'gitnestr',
  maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024 // 1MB
});

// Define repository ID
const repoId: RepositoryId = {
  ownerPubkey: 'npub1234...',
  repoName: 'my-project'
};

// Initialize a specific repository
await bridge.initializeRepo(repoId);

// Set transfer manifest for the repository
bridge.setTransferManifest({
  totalFiles: 10,
  files: ['README.md', 'src/index.js', ...]
}, repoId);

// Receive file chunks for the repository
await bridge.receiveChunk({
  path: 'README.md',
  index: 0,
  totalChunks: 1,
  data: new Uint8Array([...])
}, repoId);

// Check if transfer is complete
if (bridge.isTransferComplete(repoId)) {
  // Verify the transfer
  const verification = await bridge.verifyTransfer(repoId);
  if (verification.success) {
    // Get repository information
    const repo = await bridge.getRepository(repoId);
    console.log('Repository loaded:', repo);
  }
}

// List all repositories
const repositories = await bridge.listRepositories();
console.log('Available repositories:', repositories);

// Access the underlying LightningFS instance
const fs = bridge.getFileSystem();
// Now you can use fs directly or with isomorphic-git
```

## API Reference

### Types

```typescript
interface RepositoryId {
  ownerPubkey: string;
  repoName: string;
}

interface BrowserGitBridgeOptions {
  fsName?: string;          // Name for LightningFS instance (default: 'gitnestr')
  maxRepoSize?: number;     // Maximum repository size (default: 1GB)
  chunkSize?: number;       // Size of transfer chunks (default: 1MB)
  cacheSize?: number;       // LightningFS cache size (default: 100MB)
  persistCache?: boolean;   // Persist filesystem cache (default: true)
}

interface TransferManifest {
  totalFiles: number;
  files: string[];
}

interface FileChunk {
  path: string;
  index: number;
  totalChunks: number;
  data: Uint8Array;
}

interface GitRepository {
  path: string;
  size: number;
  branches: string[];
  head: string;
  remotes: string[];
}
```

### Methods

#### getFileSystem

```typescript
getFileSystem(): FS
```

Returns the underlying LightningFS instance for direct filesystem access.

#### initializeRepo

```typescript
async initializeRepo(repoId: RepositoryId): Promise<void>
```

Initializes a new repository at `/<ownerPubkey>:<repoName>/`.

#### setTransferManifest

```typescript
setTransferManifest(manifest: TransferManifest, repoId: RepositoryId): void
```

Sets the expected files for a repository transfer.

#### receiveChunk

```typescript
async receiveChunk(chunk: FileChunk, repoId: RepositoryId): Promise<void>
```

Receives and processes a file chunk for a specific repository.

#### isTransferComplete

```typescript
isTransferComplete(repoId: RepositoryId): boolean
```

Checks if all expected files have been received for a repository.

#### verifyTransfer

```typescript
async verifyTransfer(repoId: RepositoryId): Promise<{ success: boolean; errors: string[] }>
```

Verifies the integrity of a completed transfer.

#### getRepository

```typescript
async getRepository(repoId: RepositoryId): Promise<GitRepository>
```

Gets repository information including branches, remotes, and HEAD.

#### listRepositories

```typescript
async listRepositories(): Promise<RepositoryId[]>
```

Lists all repositories in the filesystem.

#### repositoryExists

```typescript
async repositoryExists(repoId: RepositoryId): Promise<boolean>
```

Checks if a repository exists.

#### deleteRepository

```typescript
async deleteRepository(repoId: RepositoryId): Promise<void>
```

Deletes a repository and all its files.

#### init

```typescript
async init(): Promise<void>
```

Clears all repositories and resets the filesystem (for testing/cleanup).

## Working with isomorphic-git

Once you have the filesystem instance, you can use it directly with isomorphic-git:

```typescript
import * as git from 'isomorphic-git';

const fs = bridge.getFileSystem();
const repoPath = `/${repoId.ownerPubkey}:${repoId.repoName}`;

// List commits
const commits = await git.log({
  fs,
  dir: repoPath,
  depth: 5
});

// Check status
const status = await git.statusMatrix({
  fs,
  dir: repoPath
});

// Read a file
const content = await fs.promises.readFile(`${repoPath}/README.md`, 'utf8');
```

## Error Handling

The package uses the `GitBridgeError` class for error handling:

```typescript
try {
  await bridge.receiveChunk(chunk, repoId);
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
- `REPOSITORY_NOT_FOUND`: Repository doesn't exist
- `PERMISSION_DENIED`: Permission denied
- `SIZE_LIMIT_EXCEEDED`: Size limit exceeded
- `TRANSFER_ERROR`: Error during chunk transfer
- `INTERNAL_ERROR`: Internal error

## Migration from Single Repository

If you were using the previous single-repository API, here's how to migrate:

```typescript
// Old API
await bridge.initializeRepo('/my-repo');
await bridge.receiveChunk(chunk);
const repo = await bridge.getRepository('/my-repo');

// New API
const repoId = { ownerPubkey: 'default', repoName: 'my-repo' };
await bridge.initializeRepo(repoId);
await bridge.receiveChunk(chunk, repoId);
const repo = await bridge.getRepository(repoId);
```

## Example

See the `example` directory in the root package for a complete working example.
