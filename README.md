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
npm install @GitNestr/electron-git-bridge @GitNestr/browser-git-bridge

# For GitNestr CLI integration
npm install @GitNestr/electron-GitNestr-bridge @GitNestr/browser-GitNestr-bridge
```

## Architecture

The SDK consists of four main packages:

### Git Bridge Packages

1. `@GitNestr/electron-git-bridge`: Runs in the main process, handles filesystem access for Git repositories
2. `@GitNestr/browser-git-bridge`: Runs in the renderer process, manages in-memory filesystem for Git repositories

### GitNestr Bridge Packages

3. `@GitNestr/electron-GitNestr-bridge`: Runs in the main process, interfaces with the GitNestr CLI
4. `@GitNestr/browser-GitNestr-bridge`: Runs in the renderer process, communicates with the main process via IPC

## Usage

### Git Bridge Usage

#### Main Process (Electron)

```typescript
import { GitBridge } from "@GitNestr/electron-git-bridge";

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
import { BrowserGitBridge } from "@GitNestr/browser-git-bridge";

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
import { GitNestrBridge } from "@GitNestr/electron-GitNestr-bridge";
import { app, BrowserWindow, ipcMain } from "electron";

// Create a new GitNestrBridge instance
const GitNestr = new GitNestrBridge({
  GitNestrPath: "/path/to/GitNestr", // Optional: defaults to 'GitNestr' in PATH
  timeout: 30000, // Optional: timeout in milliseconds
});

// Set up IPC handler for GitNestr bridge
ipcMain.handle("GitNestr-bridge", async (event, { request }) => {
  try {
    const { id, method, params } = request;

    // Call the appropriate method on the GitNestrBridge instance
    const result = await GitNestr[method](...params);

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

// Forward events from GitNestrBridge to renderer
GitNestr.addListener("event", (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("GitNestr-bridge-event", {
      type: "event",
      event,
    });
  }
});
```

#### Renderer Process (Browser)

```typescript
import { BrowserGitNestrBridge } from "@GitNestr/browser-GitNestr-bridge";

// Create a new BrowserGitNestrBridge instance
const GitNestr = new BrowserGitNestrBridge({
  timeout: 30000, // Optional: timeout in milliseconds
});

// Initialize a new repository
await GitNestr.init("/path/to/repo");

// Clone a repository
await GitNestr.clone(
  "GitNestr://example.com/repo",
  "/path/to/destination",
  "keyAlias"
);

// Pull changes
await GitNestr.pull("/path/to/repo", "branch");

// Push changes
await GitNestr.push("/path/to/repo", "privateKey");

// Generate keys
const { privateKey, publicKey } = await GitNestr.generateKeys();

// Store a key
await GitNestr.storeKey("alias", privateKey, "passphrase");

// Unlock a key
const key = await GitNestr.unlockKey("alias", "passphrase");

// Listen for events
GitNestr.addListener("event", (event) => {
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

#### ElectronGitNestrBridge Options

```typescript
interface GitNestrBridgeOptions {
  GitNestrPath?: string; // Path to GitNestr executable (default: 'GitNestr' in PATH)
  timeout?: number; // Command timeout in milliseconds (default: 60000)
  env?: Record<string, string>; // Custom environment variables
  relays?: string[]; // List of relay URLs
}
```

#### BrowserGitNestrBridge Options

```typescript
interface BrowserGitNestrBridgeOptions {
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
  await GitNestr.pull("/path/to/repo");
} catch (error) {
  if (error instanceof GitNestrError) {
    console.error("GitNestr operation failed:", error.message);
    console.error("Error code:", error.code);
    console.error("Additional info:", error.details);

    if (error.code === GitNestrErrorCode.TIMEOUT) {
      // Handle timeout error
    } else if (error.code === GitNestrErrorCode.COMMAND_FAILED) {
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

#### ElectronGitNestrBridge

- `constructor(options?: GitNestrBridgeOptions)`
- `async executeCommand(command: string, args?: string[], options?: GitNestrCommandOptions): Promise<GitNestrCommandResult>`
- `async init(repoPath: string): Promise<GitNestrRepository>`
- `async clone(url: string, destPath: string, keyAlias?: string): Promise<GitNestrRepository>`
- `async pull(repoPath: string, branch?: string): Promise<GitNestrCommandResult>`
- `async push(repoPath: string, privateKey?: string): Promise<GitNestrCommandResult>`
- `async fetch(repoPath: string, branch?: string, privateKey?: string): Promise<GitNestrCommandResult>`
- `async archive(url: string, branch: string, privateKey: string, keyAlias?: string): Promise<string[]>`
- `async generateKeys(): Promise<{ privateKey: string; publicKey: string }>`
- `async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void>`
- `async unlockKey(alias: string, passphrase: string): Promise<string>`
- `addListener(event: 'event', listener: GitNestrEventListener): this`
- `removeListener(event: 'event', listener: GitNestrEventListener): this`
- `cancelAll(): void`

#### BrowserGitNestrBridge

- `constructor(options?: BrowserGitNestrBridgeOptions)`
- `async init(repoPath: string): Promise<GitNestrRepository>`
- `async clone(url: string, destPath: string, keyAlias?: string): Promise<GitNestrRepository>`
- `async pull(repoPath: string, branch?: string): Promise<GitNestrCommandResult>`
- `async push(repoPath: string, privateKey?: string): Promise<GitNestrCommandResult>`
- `async fetch(repoPath: string, branch?: string, privateKey?: string): Promise<GitNestrCommandResult>`
- `async archive(url: string, branch: string, privateKey: string, keyAlias?: string): Promise<string[]>`
- `async generateKeys(): Promise<{ privateKey: string; publicKey: string }>`
- `async storeKey(alias: string, privateKey: string, passphrase: string): Promise<void>`
- `async unlockKey(alias: string, passphrase: string): Promise<string>`
- `addListener(event: 'event', listener: GitNestrEventListener): this`
- `removeListener(event: 'event', listener: GitNestrEventListener): this`
- `cancelAll(): void`
