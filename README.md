# GitNestr Electron SDK

A powerful SDK for Electron applications that provides both Git repository management and GitNestr CLI integration, enabling seamless transfer of Git repositories and interaction with the HORNET Storage network.

## Features

### Git Bridge

- 🔄 Efficient transfer of Git repositories from disk to browser memory
- 📦 Chunked file transfer to handle large repositories
- 🌳 Full Git repository structure preservation
- 🔍 Repository metadata access (branches, remotes, HEAD)
- ⚡ Built on LightningFS for high-performance in-memory filesystem
- 🛡️ Error handling and transfer verification

### GitNestr Bridge

- 🚀 Direct integration with the GitNestr CLI
- 🔐 Key management for secure repository access
- 🔄 Repository operations (init, clone, push, pull, fetch)
- 📦 Archive retrieval for repository DAGs
- 🛡️ Comprehensive error handling and event system

## Installation

```bash
# For Git repository management
npm install @gitnestr/electron-git-bridge @gitnestr/browser-git-bridge

# For gitnestr CLI integration
npm install @gitnestr/electron-gitnestr-bridge @gitnestr/browser-gitnestr-bridge
```

## Architecture

The SDK consists of four main packages:

### Git Bridge Packages

1. `@gitnestr/electron-git-bridge`: Runs in the main process, handles filesystem access for Git repositories
2. `@gitnestr/browser-git-bridge`: Runs in the renderer process, manages in-memory filesystem for Git repositories

### GitNestr Bridge Packages

3. `@gitnestr/electron-gitnestr-bridge`: Runs in the main process, interfaces with the GitNestr CLI
4. `@gitnestr/browser-gitnestr-bridge`: Runs in the renderer process, communicates with the main process via IPC

## Usage

### Git Bridge Usage

#### Main Process (Electron)

```typescript
import { GitBridge } from "@gitnestr/electron-git-bridge";

// Initialize GitBridge with repository path
const bridge = new GitBridge("/path/to/repository");

// Get repository metadata
const metadata = await bridge.getMetadata();
console.log("Repository info:", metadata);

// Stream repository to renderer
for await (const chunk of bridge.streamRepository()) {
  // If it's a manifest, send it first
  if ("manifest" in chunk) {
    mainWindow.webContents.send("repo-metadata", {
      ...metadata,
      manifest: chunk.manifest,
    });
    continue;
  }

  // Send file chunks to renderer
  mainWindow.webContents.send("repo-chunk", chunk);
}
```

#### Renderer Process (Browser)

```typescript
import { BrowserGitBridge } from "@gitnestr/browser-git-bridge";

// Initialize BrowserGitBridge
const bridge = new BrowserGitBridge({
  fsName: "my-git-repo",
  persistCache: false,
});

// Initialize filesystem
await bridge.init();

// Handle repository metadata and manifest
ipcRenderer.on("repo-metadata", async (_, data) => {
  bridge.setTransferManifest(data.manifest);
  updateUI(data); // Update UI with repository info
});

// Handle incoming file chunks
ipcRenderer.on("repo-chunk", async (_, chunk) => {
  try {
    await bridge.receiveChunk(chunk);

    // Check if transfer is complete
    if (bridge.isTransferComplete()) {
      // Verify the transfer
      const verification = await bridge.verifyTransfer();
      if (verification.success) {
        // Access repository information
        const repo = await bridge.getRepository("/");
        console.log("Repository loaded:", repo);
      } else {
        console.error("Transfer verification failed:", verification.errors);
      }
    }
  } catch (error) {
    console.error("Error receiving chunk:", error);
  }
});
```

### GitNestr Bridge Usage

#### Main Process (Electron)

```typescript
import { GitnestrBridge } from "@gitnestr/electron-gitnestr-bridge";
import { app, BrowserWindow, ipcMain } from "electron";

// Create a new GitnestrBridge instance
const gitnestr = new GitnestrBridge({
  gitnestrPath: "/path/to/gitnestr", // Optional: defaults to 'gitnestr' in PATH
  timeout: 30000, // Optional: timeout in milliseconds
});

// Set up IPC handler for gitnestr bridge
ipcMain.handle("gitnestr-bridge", async (event, { request }) => {
  try {
    const { id, method, params } = request;

    // Call the appropriate method on the GitnestrBridge instance
    const result = await gitnestr[method](...params);

    // Return the result
    return { id, result };
  } catch (error) {
    // Handle errors
    return {
      id: request.id,
      error: {
        code: error.code || "INTERNAL_ERROR",
        message: error.message || "Unknown error",
        details: error.details,
      },
    };
  }
});

// Forward events from GitnestrBridge to renderer
gitnestr.addListener("event", (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("gitnestr-bridge-event", {
      type: "event",
      event,
    });
  }
});
```

#### Renderer Process (Browser)

```typescript
import { BrowserGitnestrBridge } from "@gitnestr/browser-gitnestr-bridge";

// Create a new BrowserGitnestrBridge instance
const gitnestr = new BrowserGitnestrBridge({
  timeout: 30000, // Optional: timeout in milliseconds
});

// Initialize a new repository
await gitnestr.init("/path/to/repo");

// Clone a repository
await gitnestr.clone(
  "gitnestr://example.com/repo",
  "/path/to/destination",
  "keyAlias"
);

// Pull changes
await gitnestr.pull("/path/to/repo", "branch");

// Push changes
await gitnestr.push("/path/to/repo", "privateKey");

// Generate keys
const { privateKey, publicKey } = await gitnestr.generateKeys();

// Store a key
await gitnestr.storeKey("alias", privateKey, "passphrase");

// Unlock a key
const key = await gitnestr.unlockKey("alias", "passphrase");

// Listen for events
gitnestr.addListener("event", (event) => {
  if (event.type === "progress") {
    console.log(`Progress: ${event.message}`);
  } else if (event.type === "error") {
    console.error(`Error: ${event.message}`);
  }
});
```

## Configuration Options

### Git Bridge Options

#### ElectronGitBridge Options

```typescript
interface GitBridgeOptions {
  maxRepoSize?: number; // Maximum repository size (default: 1GB)
  chunkSize?: number; // Size of transfer chunks (default: 1MB)
  excludePatterns?: string[]; // Glob patterns to exclude (default: ['node_modules/**'])
  includeGitHistory?: boolean; // Include .git directory (default: true)
}
```

#### BrowserGitBridge Options

```typescript
interface BrowserGitBridgeOptions {
  fsName?: string; // Name for LightningFS instance
  maxRepoSize?: number; // Maximum repository size (default: 1GB)
  chunkSize?: number; // Size of transfer chunks (default: 1MB)
  cacheSize?: number; // LightningFS cache size (default: 100MB)
  persistCache?: boolean; // Persist filesystem cache (default: true)
}
```

### GitNestr Bridge Options

#### ElectronGitnestrBridge Options

```typescript
interface GitnestrBridgeOptions {
  gitnestrPath?: string; // Path to gitnestr executable (default: 'gitnestr' in PATH)
  timeout?: number; // Command timeout in milliseconds (default: 60000)
  env?: Record<string, string>; // Custom environment variables
  relays?: string[]; // List of relay URLs
}
```

#### BrowserGitnestrBridge Options

```typescript
interface BrowserGitnestrBridgeOptions {
  timeout?: number; // Request timeout in milliseconds (default: 60000)
  relays?: string[]; // List of relay URLs
}
```

## Error Handling

### Git Bridge Errors

```typescript
try {
  await bridge.receiveChunk(chunk);
} catch (error) {
  if (error instanceof GitBridgeError) {
    console.error("Git operation failed:", error.message);
    console.error("Error code:", error.code);
    console.error("Additional info:", error.details);
  }
}
```

### GitNestr Bridge Errors

```typescript
try {
  await gitnestr.pull("/path/to/repo");
} catch (error) {
  if (error instanceof GitnestrError) {
    console.error("Gitnestr operation failed:", error.message);
    console.error("Error code:", error.code);
    console.error("Additional info:", error.details);

    if (error.code === GitnestrErrorCode.TIMEOUT) {
      // Handle timeout error
    } else if (error.code === GitnestrErrorCode.COMMAND_FAILED) {
      // Handle command failure
    }
  }
}
```

## Example Application

Check out the `example` directory for a complete working example of:

- Repository selection dialog
- Progress tracking
- Error handling
- Repository information display
- GitNestr CLI integration

To run the example:

```bash
cd example
npm install
npm start
```

## API Reference

### Git Bridge API

#### ElectronGitBridge

- `constructor(repoPath: string, options?: GitBridgeOptions)`
- `async getMetadata(): Promise<GitRepository>`
- `async *streamRepository(): AsyncGenerator<FileChunk | { manifest: TransferManifest }>`
- `async validateRepo(): Promise<ValidationResult>`

#### BrowserGitBridge

- `constructor(options?: BrowserGitBridgeOptions)`
- `async init(): Promise<void>`
- `setTransferManifest(manifest: TransferManifest): void`
- `async receiveChunk(chunk: FileChunk): Promise<void>`
- `isTransferComplete(): boolean`
- `async verifyTransfer(): Promise<{ success: boolean; errors: string[] }>`
- `async getRepository(path: string): Promise<GitRepository>`

### GitNestr Bridge API

#### ElectronGitnestrBridge

- `constructor(options?: GitnestrBridgeOptions)`
- `async executeCommand(command: string, args?: string[], options?: GitnestrCommandOptions): Promise<GitnestrCommandResult>`
- `async init(repoPath: string): Promise<GitnestrRepository>`
- `async clone(url: string, destPath: string, keyAlias?: string): Promise<GitnestrRepository>`
- `async pull(repoPath: string, branch?: string): Promise<GitnestrCommandResult>`
- `async push(repoPath: string, privateKey?: string): Promise<GitnestrCommandResult>`
- `async fetch(repoPath: string, branch?: string, privateKey?: string): Promise<GitnestrCommandResult>`
- `async archive(url: string, branch: string, privateKey: string, keyAlias?: string): Promise<string[]>`
- `async generateKeys(): Promise<{ privateKey: string; publicKey: string }>`
- `async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void>`
- `async unlockKey(alias: string, passphrase: string): Promise<string>`
- `addListener(event: 'event', listener: GitnestrEventListener): this`
- `removeListener(event: 'event', listener: GitnestrEventListener): this`
- `cancelAll(): void`

#### BrowserGitnestrBridge

- `constructor(options?: BrowserGitnestrBridgeOptions)`
- `async init(repoPath: string): Promise<GitnestrRepository>`
- `async clone(url: string, destPath: string, keyAlias?: string): Promise<GitnestrRepository>`
- `async pull(repoPath: string, branch?: string): Promise<GitnestrCommandResult>`
- `async push(repoPath: string, privateKey?: string): Promise<GitnestrCommandResult>`
- `async fetch(repoPath: string, branch?: string, privateKey?: string): Promise<GitnestrCommandResult>`
- `async archive(url: string, branch: string, privateKey: string, keyAlias?: string): Promise<string[]>`
- `async generateKeys(): Promise<{ privateKey: string; publicKey: string }>`
- `async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void>`
- `async unlockKey(alias: string, passphrase: string): Promise<string>`
- `addListener(event: 'event', listener: GitnestrEventListener): this`
- `removeListener(event: 'event', listener: GitnestrEventListener): this`
- `cancelAll(): void`
