# @gitnestr/browser-gitnestr-bridge

A browser-side package for Electron's renderer process to communicate with the gitnestr CLI via IPC.

## Installation

```bash
npm install @gitnestr/browser-gitnestr-bridge
```

## Requirements

- Electron 22+
- @gitnestr/electron-gitnestr-bridge installed in the main process

## Usage

### Main Process Setup

First, you need to set up the IPC handler in your Electron main process:

```typescript
// In main.ts or main.js
import { app, BrowserWindow, ipcMain } from "electron";
import { GitnestrBridge } from "@gitnestr/electron-gitnestr-bridge";

let mainWindow: BrowserWindow;
const gitnestr = new GitnestrBridge();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Load your app
  mainWindow.loadFile("index.html");
}

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

app.whenReady().then(createWindow);
```

### Preload Script

Set up a preload script to expose the IPC communication to the renderer process:

```typescript
// In preload.ts or preload.js
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gitnestrBridge", {
  sendRequest: (request) => ipcRenderer.invoke("gitnestr-bridge", { request }),
  onEvent: (callback) => {
    const listener = (_, message) => callback(message);
    ipcRenderer.on("gitnestr-bridge-event", listener);
    return () => {
      ipcRenderer.removeListener("gitnestr-bridge-event", listener);
    };
  },
});
```

### Renderer Process Usage

```typescript
import { BrowserGitnestrBridge } from "@gitnestr/browser-gitnestr-bridge";

// Create a new BrowserGitnestrBridge instance
const gitnestr = new BrowserGitnestrBridge({
  timeout: 30000, // Optional: timeout in milliseconds, defaults to 60000
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

// Fetch changes without merging
await gitnestr.fetch("/path/to/repo", "branch", "privateKey");

// Retrieve archive DAG for a repository
const paths = await gitnestr.archive(
  "gitnestr://example.com/repo",
  "branch",
  "privateKey",
  "keyAlias"
);

// Generate keys
const { privateKey, publicKey } = await gitnestr.generateKeys();

// Store a key
await gitnestr.storeKey("alias", privateKey, "passphrase");

// Unlock a key
const key = await gitnestr.unlockKey("alias", "passphrase");
```

### Event Handling

```typescript
// Listen for events
gitnestr.addListener("event", (event) => {
  if (event.type === "progress") {
    console.log(`Progress: ${event.message}`);
  } else if (event.type === "error") {
    console.error(`Error: ${event.message}`);
  } else if (event.type === "success") {
    console.log(`Success: ${event.message}`);
  }
});

// Remove event listener
gitnestr.removeListener("event", listener);

// Cancel all pending requests
gitnestr.cancelAll();
```

### Error Handling

```typescript
import {
  GitnestrError,
  GitnestrErrorCode,
} from "@gitnestr/browser-gitnestr-bridge";

try {
  await gitnestr.pull("/path/to/repo");
} catch (error) {
  if (error instanceof GitnestrError) {
    console.error(`Error code: ${error.code}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error details: ${JSON.stringify(error.details)}`);

    if (error.code === GitnestrErrorCode.TIMEOUT) {
      // Handle timeout error
    } else if (error.code === GitnestrErrorCode.IPC_ERROR) {
      // Handle IPC error
    }
  } else {
    // Handle other errors
    console.error(error);
  }
}
```

## API Reference

### `BrowserGitnestrBridge`

The main class for interacting with the gitnestr CLI via IPC.

#### Constructor

```typescript
new BrowserGitnestrBridge(options?: BrowserGitnestrBridgeOptions)
```

#### Methods

- `init(repoPath: string): Promise<GitnestrRepository>` - Initialize a new repository
- `clone(url: string, destPath: string, keyAlias?: string): Promise<GitnestrRepository>` - Clone a repository
- `pull(repoPath: string, branch?: string): Promise<GitnestrCommandResult>` - Pull changes
- `push(repoPath: string, privateKey?: string): Promise<GitnestrCommandResult>` - Push changes
- `fetch(repoPath: string, branch?: string, privateKey?: string): Promise<GitnestrCommandResult>` - Fetch changes without merging
- `archive(url: string, branch: string, privateKey: string, keyAlias?: string): Promise<string[]>` - Retrieve archive DAG for a repository
- `generateKeys(): Promise<{ privateKey: string; publicKey: string }>` - Generate a new key pair
- `storeKey(alias: string, privateKey: string, passphrase: string): Promise<void>` - Store a key
- `unlockKey(alias: string, passphrase: string): Promise<string>` - Unlock a key
- `addListener(event: 'event', listener: GitnestrEventListener): this` - Add an event listener
- `removeListener(event: 'event', listener: GitnestrEventListener): this` - Remove an event listener
- `cancelAll(): void` - Cancel all pending requests
