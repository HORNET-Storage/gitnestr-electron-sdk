# @gitnestr/browser-git-bridge

The renderer (browser) component of the Gitnestr SDK, responsible for receiving Git repositories from the main process and managing them in an in-memory filesystem using LightningFS and isomorphic-git.

## Installation

```bash
npm install @gitnestr/browser-git-bridge
```

## Usage

```typescript
import { BrowserGitBridge } from '@gitnestr/browser-git-bridge';

// Initialize with options
const bridge = new BrowserGitBridge({
  fsName: 'my-git-repo',
  maxRepoSize: 1024 * 1024 * 1024, // 1GB
  chunkSize: 1024 * 1024, // 1MB
  cacheSize: 100 * 1024 * 1024, // 100MB
  persistCache: false
});

// Initialize filesystem
await bridge.init();

// Handle repository metadata and manifest
ipcRenderer.on('repo-metadata', async (_, data) => {
  // Set up transfer manifest
  bridge.setTransferManifest(data.manifest);
  
  // Update UI with repository info
  console.log('Repository info:', {
    path: data.path,
    size: data.size,
    branches: data.branches,
    head: data.head,
    remotes: data.remotes
  });
});

// Handle incoming file chunks
ipcRenderer.on('repo-chunk', async (_, chunk) => {
  try {
    // Process chunk
    await bridge.receiveChunk(chunk);
    
    // Update progress UI
    updateProgress(chunk.index, chunk.totalChunks);
    
    // Check if transfer is complete
    if (bridge.isTransferComplete()) {
      // Verify the transfer
      const verification = await bridge.verifyTransfer();
      if (verification.success) {
        // Access repository through isomorphic-git
        const repo = await bridge.getRepository('/');
        console.log('Repository loaded:', repo);
      } else {
        console.error('Transfer verification failed:', verification.errors);
      }
    }
  } catch (error) {
    console.error('Error receiving chunk:', error);
  }
});
```

## API Reference

### Constructor

```typescript
constructor(options?: BrowserGitBridgeOptions)
```

Creates a new BrowserGitBridge instance.

### Options

```typescript
interface BrowserGitBridgeOptions {
  fsName?: string;          // Name for LightningFS instance (default: 'gitnestr')
  maxRepoSize?: number;     // Maximum repository size (default: 1GB)
  chunkSize?: number;       // Size of transfer chunks (default: 1MB)
  cacheSize?: number;       // LightningFS cache size (default: 100MB)
  persistCache?: boolean;   // Persist filesystem cache (default: true)
}
```

### Methods

#### init

```typescript
async init(): Promise<void>
```

Initializes the in-memory filesystem. This should be called before any other operations.

#### setTransferManifest

```typescript
setTransferManifest(manifest: TransferManifest): void
```

Sets up the transfer manifest that describes the files to be received.

```typescript
interface TransferManifest {
  totalFiles: number;
  files: string[];
}
```

#### receiveChunk

```typescript
async receiveChunk(chunk: FileChunk): Promise<void>
```

Processes an incoming file chunk and writes it to the in-memory filesystem.

```typescript
interface FileChunk {
  index: number;
  totalChunks: number;
  data: Uint8Array;
  path: string;
}
```

#### isTransferComplete

```typescript
isTransferComplete(): boolean
```

Checks if all expected files have been received based on the transfer manifest.

#### verifyTransfer

```typescript
async verifyTransfer(): Promise<{ success: boolean; errors: string[] }>
```

Verifies that all files were transferred correctly by:
- Checking file existence
- Verifying file accessibility
- Validating file types

#### getRepository

```typescript
async getRepository(path: string): Promise<GitRepository>
```

Gets repository information using isomorphic-git.

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

## Error Handling

The package uses the `GitBridgeError` class for error handling:

```typescript
try {
  await bridge.receiveChunk(chunk);
} catch (error) {
  if (error instanceof GitBridgeError) {
    console.error('Error code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
  }
}
```

Error codes:
- `TRANSFER_ERROR`: Error during chunk transfer/processing
- `INTERNAL_ERROR`: Unexpected internal error

## Integration with isomorphic-git

Once a repository is loaded, you can use isomorphic-git's full API to work with it:

```typescript
import * as git from 'isomorphic-git';

// Get the filesystem instance
const fs = bridge.getFS();

// Use isomorphic-git operations
const commits = await git.log({
  fs,
  dir: '/',
  depth: 5
});
```

## Example

See the `example` directory in the root package for a complete working example.
