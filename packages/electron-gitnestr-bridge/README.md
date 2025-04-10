# @gitnestr/electron-gitnestr-bridge

A Node.js package for Electron's main process to interact with the gitnestr CLI application.

## Installation

```bash
npm install @gitnestr/electron-gitnestr-bridge
```

## Requirements

- Node.js 14+
- Electron 22+
- gitnestr CLI installed and available in PATH (or specify the path in options)

## Usage

### Basic Usage

```typescript
import { GitnestrBridge } from '@gitnestr/electron-gitnestr-bridge';

// Create a new GitnestrBridge instance
const gitnestr = new GitnestrBridge({
  gitnestrPath: '/path/to/gitnestr', // Optional: defaults to 'gitnestr' in PATH
  timeout: 30000, // Optional: timeout in milliseconds, defaults to 60000
  env: { /* Custom environment variables */ } // Optional
});

// Initialize a new repository
await gitnestr.init('/path/to/repo');

// Clone a repository
await gitnestr.clone('gitnestr://example.com/repo', '/path/to/destination', 'keyAlias');

// Pull changes
await gitnestr.pull('/path/to/repo', 'branch');

// Push changes
await gitnestr.push('/path/to/repo', 'privateKey');

// Fetch changes without merging
await gitnestr.fetch('/path/to/repo', 'branch', 'privateKey');

// Retrieve archive DAG for a repository
const paths = await gitnestr.archive('gitnestr://example.com/repo', 'branch', 'privateKey', 'keyAlias');

// Generate keys
const { privateKey, publicKey } = await gitnestr.generateKeys();

// Store a key
await gitnestr.storeKey('alias', privateKey, 'passphrase');

// Unlock a key
const key = await gitnestr.unlockKey('alias', 'passphrase');

```

### Event Handling

```typescript
// Listen for events
gitnestr.addListener('event', (event) => {
  if (event.type === 'progress') {
    console.log(`Progress: ${event.message}`);
  } else if (event.type === 'error') {
    console.error(`Error: ${event.message}`);
  } else if (event.type === 'success') {
    console.log(`Success: ${event.message}`);
  }
});

// Remove event listener
gitnestr.removeListener('event', listener);

// Cancel all active processes
gitnestr.cancelAll();
```

### Error Handling

```typescript
import { GitnestrError, GitnestrErrorCode } from '@gitnestr/electron-gitnestr-bridge';

try {
  await gitnestr.pull('/path/to/repo');
} catch (error) {
  if (error instanceof GitnestrError) {
    console.error(`Error code: ${error.code}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error details: ${JSON.stringify(error.details)}`);
    
    if (error.code === GitnestrErrorCode.TIMEOUT) {
      // Handle timeout error
    } else if (error.code === GitnestrErrorCode.COMMAND_FAILED) {
      // Handle command failure
    }
  } else {
    // Handle other errors
    console.error(error);
  }
}
```

## API Reference

### `GitnestrBridge`

The main class for interacting with the gitnestr CLI.

#### Constructor

```typescript
new GitnestrBridge(options?: GitnestrBridgeOptions)
```

#### Methods

- `executeCommand(command: string, args?: string[], options?: GitnestrCommandOptions): Promise<GitnestrCommandResult>` - Execute a gitnestr command
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
- `cancelAll(): void` - Cancel all active processes

## License

MIT
