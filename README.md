# Gitnestr Electron SDK

A powerful SDK for handling Git repositories in Electron applications, enabling seamless transfer of Git repositories from the filesystem to the browser's memory using LightningFS and isomorphic-git.

## Features

- 🔄 Efficient transfer of Git repositories from disk to browser memory
- 📦 Chunked file transfer to handle large repositories
- 🌳 Full Git repository structure preservation
- 🔍 Repository metadata access (branches, remotes, HEAD)
- ⚡ Built on LightningFS for high-performance in-memory filesystem
- 🛡️ Error handling and transfer verification

## Installation

```bash
npm install @gitnestr/electron-git-bridge @gitnestr/browser-git-bridge
```

## Architecture

The SDK consists of two main packages:

1. `@gitnestr/electron-git-bridge`: Runs in the main process, handles filesystem access
2. `@gitnestr/browser-git-bridge`: Runs in the renderer process, manages in-memory filesystem

## Usage

### Main Process (Electron)

```typescript
import { GitBridge } from '@gitnestr/electron-git-bridge';

// Initialize GitBridge with repository path
const bridge = new GitBridge('/path/to/repository');

// Get repository metadata
const metadata = await bridge.getMetadata();
console.log('Repository info:', metadata);

// Stream repository to renderer
for await (const chunk of bridge.streamRepository()) {
  // If it's a manifest, send it first
  if ('manifest' in chunk) {
    mainWindow.webContents.send('repo-metadata', {
      ...metadata,
      manifest: chunk.manifest
    });
    continue;
  }
  
  // Send file chunks to renderer
  mainWindow.webContents.send('repo-chunk', chunk);
}
```

### Renderer Process (Browser)

```typescript
import { BrowserGitBridge } from '@gitnestr/browser-git-bridge';

// Initialize BrowserGitBridge
const bridge = new BrowserGitBridge({
  fsName: 'my-git-repo',
  persistCache: false
});

// Initialize filesystem
await bridge.init();

// Handle repository metadata and manifest
ipcRenderer.on('repo-metadata', async (_, data) => {
  bridge.setTransferManifest(data.manifest);
  updateUI(data); // Update UI with repository info
});

// Handle incoming file chunks
ipcRenderer.on('repo-chunk', async (_, chunk) => {
  try {
    await bridge.receiveChunk(chunk);
    
    // Check if transfer is complete
    if (bridge.isTransferComplete()) {
      // Verify the transfer
      const verification = await bridge.verifyTransfer();
      if (verification.success) {
        // Access repository information
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

## Configuration Options

### ElectronGitBridge Options

```typescript
interface GitBridgeOptions {
  maxRepoSize?: number;      // Maximum repository size (default: 1GB)
  chunkSize?: number;        // Size of transfer chunks (default: 1MB)
  excludePatterns?: string[]; // Glob patterns to exclude (default: ['node_modules/**'])
  includeGitHistory?: boolean; // Include .git directory (default: true)
}
```

### BrowserGitBridge Options

```typescript
interface BrowserGitBridgeOptions {
  fsName?: string;          // Name for LightningFS instance
  maxRepoSize?: number;     // Maximum repository size (default: 1GB)
  chunkSize?: number;       // Size of transfer chunks (default: 1MB)
  cacheSize?: number;       // LightningFS cache size (default: 100MB)
  persistCache?: boolean;   // Persist filesystem cache (default: true)
}
```

## Error Handling

The SDK provides detailed error information through the `GitBridgeError` class:

```typescript
try {
  await bridge.receiveChunk(chunk);
} catch (error) {
  if (error instanceof GitBridgeError) {
    console.error('Git operation failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Additional info:', error.details);
  }
}
```

## Example Application

Check out the `example` directory for a complete working example of:
- Repository selection dialog
- Progress tracking
- Error handling
- Repository information display

To run the example:

```bash
cd example
npm install
npm start
```

## API Reference

### ElectronGitBridge

- `constructor(repoPath: string, options?: GitBridgeOptions)`
- `async getMetadata(): Promise<GitRepository>`
- `async *streamRepository(): AsyncGenerator<FileChunk | { manifest: TransferManifest }>`
- `async validateRepo(): Promise<ValidationResult>`

### BrowserGitBridge

- `constructor(options?: BrowserGitBridgeOptions)`
- `async init(): Promise<void>`
- `setTransferManifest(manifest: TransferManifest): void`
- `async receiveChunk(chunk: FileChunk): Promise<void>`
- `isTransferComplete(): boolean`
- `async verifyTransfer(): Promise<{ success: boolean; errors: string[] }>`
- `async getRepository(path: string): Promise<GitRepository>`

## Contributing

Contributions are welcome! Please read our contributing guidelines for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
