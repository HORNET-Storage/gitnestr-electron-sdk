import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { GitBridge } from '../../packages/electron-git-bridge';
import { getPublicKey, nip19, Filter, SimplePool, Event } from 'nostr-tools';

const { useWebSocketImplementation } = require('nostr-tools/pool');
const WebSocket = require('ws');

const gitnestrBridgeModule = require('../../packages/electron-gitnestr-bridge/commonjs-wrapper.cjs');

import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

let GitnestrBridge: any;
let mainWindow: Electron.BrowserWindow | null = null;
let gitnestrBridge: any | null = null;
let currentUserPublicKey: string | null = null;
let repositoriesDir: string = path.join(app.getPath('userData'), 'repositories');
let nostrRelays: string[] = ['ws://127.0.0.1:9001'];
let nostrPool: SimplePool | null = null;

// Add this function:
async function initGitnestrBridge() {
  GitnestrBridge = await gitnestrBridgeModule.getGitnestrBridge();
}

// Ensure repositories directory exists
fs.ensureDirSync(repositoriesDir);

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, '../index.html'));
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  useWebSocketImplementation(WebSocket);

  await initGitnestrBridge();
  await createWindow();
  
  // Initialize Nostr pool
  nostrPool = new SimplePool();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Helper function to get repository name from URL
function getRepoNameFromUrl(url: string): string {
  // Extract the last part of the URL and remove any file extension
  const urlParts = url.split('/');
  let repoName = urlParts[urlParts.length - 1];

  // Remove .git extension if present
  if (repoName.endsWith('.git')) {
    repoName = repoName.slice(0, -4);
  }

  // If no name could be extracted, generate a random one
  if (!repoName) {
    repoName = `repo-${crypto.randomBytes(4).toString('hex')}`;
  }

  return repoName;
}

// Helper function to get user's repositories directory
function getUserReposDir(publicKey: string): string {
  const userDir = path.join(repositoriesDir, publicKey);
  fs.ensureDirSync(userDir);
  return userDir;
}

// Helper function to list repositories for a user
async function listUserRepositories(publicKey: string): Promise<string[]> {
  const userDir = getUserReposDir(publicKey);
  const entries = await fs.readdir(userDir, { withFileTypes: true });
  return entries
    .filter((entry: fs.Dirent) => entry.isDirectory())
    .map((entry: fs.Dirent) => entry.name);
}

ipcMain.handle('login-with-key', async (_, privateKeyInput: string, passphrase: string = '') => {
  try {
    // 1. Parse the private key (either nsec or hex)
    const parsedPrivateKey = parsePrivateKey(privateKeyInput);

    // 2. Initialize bridge
    gitnestrBridge = new GitnestrBridge();

    // 3. Store the key
    const alias = 'default';
    await gitnestrBridge.storeKey(alias, parsedPrivateKey, passphrase);

    // 4. Unlock the key to get the public key (hex)
    await gitnestrBridge.unlockKey(alias, passphrase);
    currentUserPublicKey = getPublicKey(hexToBytes(parsedPrivateKey));

    // 5. Ensure user's repo directory exists
    getUserReposDir(currentUserPublicKey);

    // 6. Return the public key
    return { publicKey: currentUserPublicKey };

  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
});

function parsePrivateKey(input: string): string {
  if (input.startsWith('nsec')) {
    const { type, data } = nip19.decode(input);

    if (type !== 'nsec') {
      throw new Error(`Expected nsec key, got: ${type}`);
    }

    // Convert Uint8Array to hex string
    const hex = Array.from(data as Uint8Array)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');

    return hex;
  }

  if (/^[a-f0-9]{64}$/i.test(input)) {
    return input;
  }

  throw new Error('Invalid private key format');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Handle generating new keys
ipcMain.handle('generate-keys', async () => {
  try {
    // Initialize GitnestrBridge if not already done
    if (!gitnestrBridge) {
      gitnestrBridge = new GitnestrBridge();
    }

    // Generate new key pair
    const keys = await gitnestrBridge.generateKeys();
    return keys;
  } catch (error) {
    console.error('Key generation error:', error);
    throw error;
  }
});

// Handle cloning a repository
ipcMain.handle('clone-repository', async (_, url: string) => {
  if (!mainWindow || !gitnestrBridge || !currentUserPublicKey) {
    throw new Error('Not logged in');
  }

  try {
    // Get repository name from URL
    const repoName = getRepoNameFromUrl(url);

    // Get user's repositories directory
    const userReposDir = getUserReposDir(currentUserPublicKey);

    // Full path to the repository
    const repoPath = path.join(userReposDir, repoName);

    // Clone the repository
    mainWindow.webContents.send('repo-status', `Cloning repository ${url}...`);
    await gitnestrBridge.clone(url, repoPath, 'default');
    mainWindow.webContents.send('repo-status', `Repository cloned successfully to ${repoPath}`);

    // Return repository information
    return {
      name: repoName,
      path: repoPath,
      url
    };
  } catch (error) {
    mainWindow.webContents.send('repo-error', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
});

// Handle pulling updates for a repository
ipcMain.handle('pull-repository', async (_, repoName: string) => {
  if (!mainWindow || !gitnestrBridge || !currentUserPublicKey) {
    throw new Error('Not logged in');
  }

  try {
    // Get user's repositories directory
    const userReposDir = getUserReposDir(currentUserPublicKey);

    // Full path to the repository
    const repoPath = path.join(userReposDir, repoName);

    // Pull updates
    mainWindow.webContents.send('repo-status', `Pulling updates for ${repoName}...`);
    const result = await gitnestrBridge.pull(repoPath);
    mainWindow.webContents.send('repo-status', `Repository updated successfully: ${result.stdout}`);

    return {
      name: repoName,
      path: repoPath,
      result
    };
  } catch (error) {
    mainWindow.webContents.send('repo-error', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
});

// Handle listing user repositories
ipcMain.handle('list-repositories', async () => {
  if (!currentUserPublicKey) {
    throw new Error('Not logged in');
  }

  try {
    const repos = await listUserRepositories(currentUserPublicKey);
    return repos;
  } catch (error) {
    console.error('Error listing repositories:', error);
    throw error;
  }
});

// Nostr relay management
ipcMain.handle('add-relay', async (_, relay: string) => {
  if (!relay) {
    throw new Error('Relay URL is required');
  }

  if (!nostrRelays.includes(relay)) {
    nostrRelays.push(relay);
  }

  return nostrRelays;
});

ipcMain.handle('remove-relay', async (_, relay: string) => {
  nostrRelays = nostrRelays.filter(r => r !== relay);
  return nostrRelays;
});

ipcMain.handle('get-relays', async () => {
  return nostrRelays;
});

export async function getEventsOnce(
  relays: string[],
  filter: Filter,
  maxEvents = 10,
  timeoutMs = 3000
): Promise<Event[]> {
  const pool = new SimplePool();
  const events: Event[] = [];

  return new Promise((resolve) => {
    const sub = pool.subscribeMany(relays, [filter], {
      onevent(event: Event) {
        events.push(event);
        if (events.length >= maxEvents) {
          sub.close();
          resolve(events);
        }
      },
      oneose() {
        // Called when all relays send EOSE (end of stored events)
        sub.close();
        resolve(events);
      }
    });

    // Fallback timeout in case relays are slow or unresponsive
    setTimeout(() => {
      sub.close();
      resolve(events);
    }, timeoutMs);
  });
}


// Nostr repository browsing
ipcMain.handle('browse-repositories', async () => {
  if (!nostrPool) {
    throw new Error('Nostr pool not initialized');
  }

  if (nostrRelays.length === 0) {
    throw new Error('No relays configured');
  }

  try {
    // Query for permission notes (kind 16629)
    const filter = {
      kinds: [16629]
    };

    const events = await nostrPool.querySync(nostrRelays, filter);

    //const events = await getEventsOnce(nostrRelays, filter);

    console.log("Found " + events.length + " events");

    // Parse repository events
    return events.map((event: Event) => {
      // Extract repository info from event
      const repoTag = event.tags.find((tag: string[]) => tag[0] === 'r');
      if (!repoTag || !repoTag[1]) return null;

      const [author, name] = repoTag[1].split(':');
      if (!author || !name) return null;

      // Extract permissions
      const permissions = event.tags
        .filter((tag: string[]) => tag[0] === 'p' && tag.length >= 3)
        .map((tag: string[]) => ({ pubkey: tag[1], permission: tag[2] }));

      // Extract description
      const descriptionTag = event.tags.find((tag: string[]) => tag[0] === 'description');
      const description = descriptionTag ? descriptionTag[1] : undefined;

      // Extract host information
      const hostTag = event.tags.find((tag: string[]) => tag[0] === 'host');
      const host = hostTag ? hostTag[1] : '127.0.0.1:9000'; // Default if not specified

      const cloneUrl = `nestr://${host}/${author}?repo_author=${author}&repo_name=${name}`;

      return {
        id: `${author}:${name}`,
        name,
        author,
        description,
        permissions: permissions.map((p: { pubkey: string; permission: string }) => `${p.pubkey}:${p.permission}`),
        cloneUrl
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('Error browsing repositories:', error);
    throw error;
  }
});

// Handle cloning repository by info
ipcMain.handle('clone-repository-by-info', async (_, repoInfo) => {
  if (!mainWindow || !gitnestrBridge || !currentUserPublicKey) {
    throw new Error('Not logged in');
  }

  try {
    // Get user's repositories directory
    const userReposDir = getUserReposDir(currentUserPublicKey);

    // Full path to the repository
    const repoPath = path.join(userReposDir, repoInfo.name);

    // Clone the repository
    mainWindow.webContents.send('repo-status', `Cloning repository ${repoInfo.name}...`);
    await gitnestrBridge.clone(repoInfo.cloneUrl, repoPath, 'default');
    mainWindow.webContents.send('repo-status', `Repository cloned successfully to ${repoPath}`);

    // Return repository information
    return {
      name: repoInfo.name,
      path: repoPath,
      url: repoInfo.cloneUrl
    };
  } catch (error) {
    mainWindow.webContents.send('repo-error', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
});

// Handle repository selection (original functionality)
ipcMain.handle('select-repository', async (_, repoName: string) => {
  if (!mainWindow || !currentUserPublicKey) return;

  try {
    // Get user's repositories directory
    const userReposDir = getUserReposDir(currentUserPublicKey);

    // Full path to the repository
    const repoPath = path.join(userReposDir, repoName);

    // Check if repository exists
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${repoName} not found`);
    }

    const bridge = new GitBridge(repoPath);

    // Validate repository
    const validation = await bridge.validateRepo();
    if (!validation.isValid) {
      throw new Error(`Invalid repository: ${validation.errors?.join(', ')}`);
    }

    // Get repository metadata
    const metadata = await bridge.getMetadata();
    mainWindow.webContents.send('repo-metadata', metadata);

    // Stream repository files
    for await (const item of bridge.streamRepository()) {
      if ('manifest' in item) {
        // Send metadata with manifest
        const metadata = await bridge.getMetadata();
        mainWindow.webContents.send('repo-metadata', { ...metadata, manifest: item.manifest });
      } else {
        // Send file chunk
        mainWindow.webContents.send('repo-chunk', item);
      }
    }

    mainWindow.webContents.send('repo-transfer-complete');
    return metadata;

  } catch (error) {
    mainWindow.webContents.send('repo-error', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
});
