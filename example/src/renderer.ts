const { ipcRenderer } = require('electron');
const { BrowserGitBridge } = require('../packages/browser-git-bridge/dist/index.js');
const { BrowserGitnestrBridge } = require('../packages/browser-gitnestr-bridge/dist/index.js');

// Type imports for TypeScript
type IpcRendererEvent = Electron.IpcRendererEvent;
type GitRepository = import('@gitnestr/browser-git-bridge').GitRepository;
type FileChunk = import('@gitnestr/browser-git-bridge').FileChunk;
type TransferManifest = import('@gitnestr/browser-git-bridge').TransferManifest;

// UI Elements
let gitBridge: InstanceType<typeof BrowserGitBridge>;
let gitnestrBridge: InstanceType<typeof BrowserGitnestrBridge>;
let currentRepoPath = '';
let currentUserPublicKey = '';
let selectedRepo = '';

// Login section elements
let privateKeyInput: HTMLInputElement;
let passphraseInput: HTMLInputElement;
let loginButton: HTMLButtonElement;
let generateKeyButton: HTMLButtonElement;
let userInfoDiv: HTMLDivElement;
let publicKeySpan: HTMLSpanElement;

// Repository management elements
let repoManagementSection: HTMLDivElement;
let repoUrlInput: HTMLInputElement;
let cloneButton: HTMLButtonElement;
let repoList: HTMLUListElement;
let repoActions: HTMLDivElement;
let pullButton: HTMLButtonElement;
let selectButton: HTMLButtonElement;

// Nostr repository browsing elements
let nostrSection: HTMLDivElement;
let relayInput: HTMLInputElement;
let addRelayButton: HTMLButtonElement;
let relayList: HTMLUListElement;
let browseButton: HTMLButtonElement;
let repositoryBrowser: HTMLDivElement;

// Status and info elements
let statusElement: HTMLDivElement;
let repoInfoElement: HTMLPreElement;
let directoryTreeElement: HTMLDivElement;

// Repository data
let repoFiles: string[] = [];
let selectedFile: string | null = null;

// Helper Functions
function updateRepoInfo(repo: GitRepository): void {
  if (repoInfoElement) {
    repoInfoElement.textContent = JSON.stringify(repo, null, 2);
  }
}

function updateStatus(message: string): void {
  if (statusElement) {
    statusElement.textContent = message;
    console.log('Status:', message);
  }
}

function showError(error: string | Error): void {
  const errorMessage = error instanceof Error ? error.message : error;
  updateStatus(`Error: ${errorMessage}`);
  console.error('Error:', errorMessage);
}

async function refreshRepositoryList(): Promise<void> {
  try {
    // Clear current list
    repoList.innerHTML = '';
    
    // Get repositories from main process
    const repos = await ipcRenderer.invoke('list-repositories');
    
    if (repos.length === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.textContent = 'No repositories found';
      repoList.appendChild(emptyItem);
      repoActions.style.display = 'none';
      return;
    }
    
    // Add repositories to list
    repos.forEach((repo: string) => {
      const item = document.createElement('li');
      item.textContent = repo;
      item.dataset.name = repo;
      
      // Add click handler to select repository
      item.addEventListener('click', () => {
        // Remove selected class from all items
        document.querySelectorAll('#repoList li').forEach(el => {
          el.classList.remove('selected');
        });
        
        // Add selected class to clicked item
        item.classList.add('selected');
        selectedRepo = repo;
        repoActions.style.display = 'block';
      });
      
      repoList.appendChild(item);
    });
  } catch (error) {
    showError(error as Error);
  }
}

// Function to build directory tree
function buildDirectoryTree(files: string[]): void {
  if (!directoryTreeElement) return;
  
  // Clear current tree
  directoryTreeElement.innerHTML = '';
  
  if (files.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-message';
    emptyMessage.textContent = 'No files in repository';
    directoryTreeElement.appendChild(emptyMessage);
    return;
  }
  
  // Sort files to ensure directories come before their contents
  const sortedFiles = [...files].sort();
  
  // Create root ul element
  const rootUl = document.createElement('ul');
  directoryTreeElement.appendChild(rootUl);
  
  // Track created directories to avoid duplicates
  const directories: Record<string, HTMLLIElement> = {};
  
  // Process each file
  sortedFiles.forEach(filePath => {
    // Skip .git directory
    if (filePath.startsWith('.git/')) return;
    
    // Split path into parts
    const parts = filePath.split('/');
    let currentPath = '';
    let currentUl = rootUl;
    
    // Process each part of the path except the last one (which is the file)
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      // Check if we've already created this directory
      if (!directories[currentPath]) {
        // Create new directory li
        const dirLi = document.createElement('li');
        dirLi.className = 'folder';
        
        // Create folder name span
        const folderSpan = document.createElement('span');
        folderSpan.className = 'folder-name';
        folderSpan.textContent = part;
        
        // Add click handler to toggle folder
        folderSpan.addEventListener('click', () => {
          dirLi.classList.toggle('open');
          const ul = dirLi.querySelector('ul');
          if (ul) {
            ul.style.display = dirLi.classList.contains('open') ? 'block' : 'none';
          }
        });
        
        dirLi.appendChild(folderSpan);
        
        // Create new ul for this directory's contents
        const newUl = document.createElement('ul');
        newUl.style.display = 'none'; // Initially collapsed
        dirLi.appendChild(newUl);
        
        // Add to current ul
        currentUl.appendChild(dirLi);
        
        // Store for future reference
        directories[currentPath] = dirLi;
        
        // Update current ul for next iteration
        currentUl = newUl;
      } else {
        // Directory already exists, just update current ul
        currentUl = directories[currentPath].querySelector('ul') as HTMLUListElement;
      }
    }
    
    // Add the file
    const fileName = parts[parts.length - 1];
    const fileLi = document.createElement('li');
    fileLi.className = 'file';
    
    const fileSpan = document.createElement('span');
    fileSpan.className = 'file-name';
    fileSpan.textContent = fileName;
    
    // Add click handler to select file
    fileSpan.addEventListener('click', () => {
      // Remove selected class from all files
      document.querySelectorAll('.file-name').forEach(el => {
        el.classList.remove('selected-file');
      });
      
      // Add selected class to clicked file
      fileSpan.classList.add('selected-file');
      selectedFile = filePath;
      
      // TODO: Display file content
      console.log('Selected file:', filePath);
    });
    
    fileLi.appendChild(fileSpan);
    currentUl.appendChild(fileLi);
  });
  
  // Expand the root level folders by default
  rootUl.querySelectorAll(':scope > li.folder').forEach(folder => {
    folder.classList.add('open');
    const ul = folder.querySelector('ul');
    if (ul) {
      ul.style.display = 'block';
    }
  });
}

console.log('Renderer script loaded');

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM Content Loaded');
  
  // Initialize bridges
  gitBridge = new BrowserGitBridge({
    fsName: 'gitnestr-example',
    persistCache: false
  });
  await gitBridge.init();
  
  gitnestrBridge = new BrowserGitnestrBridge({
    timeout: 60000
  });

  console.log('Bridges initialized');

  // Get UI Elements
  // Login section
  privateKeyInput = document.getElementById('privateKey') as HTMLInputElement;
  passphraseInput = document.getElementById('passphrase') as HTMLInputElement;
  loginButton = document.getElementById('loginButton') as HTMLButtonElement;
  generateKeyButton = document.getElementById('generateKeyButton') as HTMLButtonElement;
  userInfoDiv = document.getElementById('userInfo') as HTMLDivElement;
  publicKeySpan = document.getElementById('publicKey') as HTMLSpanElement;
  
  // Repository management section
  repoManagementSection = document.getElementById('repoManagementSection') as HTMLDivElement;
  repoUrlInput = document.getElementById('repoUrl') as HTMLInputElement;
  cloneButton = document.getElementById('cloneButton') as HTMLButtonElement;
  repoList = document.getElementById('repoList') as HTMLUListElement;
  repoActions = document.getElementById('repoActions') as HTMLDivElement;
  pullButton = document.getElementById('pullButton') as HTMLButtonElement;
  selectButton = document.getElementById('selectButton') as HTMLButtonElement;
  
  // Nostr repository browsing section
  nostrSection = document.getElementById('nostrSection') as HTMLDivElement;
  relayInput = document.getElementById('relayInput') as HTMLInputElement;
  addRelayButton = document.getElementById('addRelayButton') as HTMLButtonElement;
  relayList = document.getElementById('relayList') as HTMLUListElement;
  browseButton = document.getElementById('browseButton') as HTMLButtonElement;
  repositoryBrowser = document.getElementById('repositoryBrowser') as HTMLDivElement;
  
  // Status and info elements
  statusElement = document.getElementById('status') as HTMLDivElement;
  repoInfoElement = document.getElementById('repoInfo') as HTMLPreElement;
  directoryTreeElement = document.getElementById('directoryTree') as HTMLDivElement;

  console.log('UI Elements initialized');

  // Event Handlers
  // Login button
  loginButton.addEventListener('click', async () => {
    try {
      const privateKey = privateKeyInput.value.trim();
      const passphrase = passphraseInput.value.trim();
      
      if (!privateKey) {
        updateStatus('Please enter a private key');
        return;
      }
      
      updateStatus('Logging in...');
      
      const result = await ipcRenderer.invoke('login-with-key', privateKey, passphrase);
      currentUserPublicKey = result.publicKey;
      
      // Update UI
      publicKeySpan.textContent = currentUserPublicKey;
      userInfoDiv.style.display = 'block';
      repoManagementSection.style.display = 'block';
      nostrSection.style.display = 'block';
      updateStatus('Logged in successfully');
      
      // Refresh repository list
      await refreshRepositoryList();
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Generate key button
  generateKeyButton.addEventListener('click', async () => {
    try {
      updateStatus('Generating new key pair...');
      
      const keys = await ipcRenderer.invoke('generate-keys');
      
      // Update UI
      privateKeyInput.value = keys.privateKey;
      updateStatus('New key pair generated. Use the login button to log in with this key.');
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Clone button
  cloneButton.addEventListener('click', async () => {
    try {
      const url = repoUrlInput.value.trim();
      
      if (!url) {
        updateStatus('Please enter a repository URL');
        return;
      }
      
      updateStatus(`Cloning repository ${url}...`);
      
      await ipcRenderer.invoke('clone-repository', url);
      
      // Clear input
      repoUrlInput.value = '';
      
      // Refresh repository list
      await refreshRepositoryList();
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Pull button
  pullButton.addEventListener('click', async () => {
    try {
      if (!selectedRepo) {
        updateStatus('Please select a repository first');
        return;
      }
      
      updateStatus(`Pulling updates for ${selectedRepo}...`);
      
      await ipcRenderer.invoke('pull-repository', selectedRepo);
      
      // Refresh repository list
      await refreshRepositoryList();
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Select button
  selectButton.addEventListener('click', async () => {
    try {
      if (!selectedRepo) {
        updateStatus('Please select a repository first');
        return;
      }
      
      updateStatus(`Loading repository ${selectedRepo}...`);
      
      await ipcRenderer.invoke('select-repository', selectedRepo);
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Nostr relay management
  // Add relay button
  addRelayButton?.addEventListener('click', async () => {
    try {
      const relay = relayInput.value.trim();
      
      if (!relay) {
        updateStatus('Please enter a relay URL');
        return;
      }
      
      updateStatus(`Adding relay ${relay}...`);
      
      const relays = await ipcRenderer.invoke('add-relay', relay);
      
      // Clear input
      relayInput.value = '';
      
      // Refresh relay list
      refreshRelayList(relays);
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Browse repositories button
  browseButton?.addEventListener('click', async () => {
    try {
      updateStatus('Browsing repositories...');
      
      const repositories = await ipcRenderer.invoke('browse-repositories');
      
      // Display repositories
      displayRepositories(repositories);
      
    } catch (error) {
      showError(error as Error);
    }
  });
  
  // Helper function to refresh relay list
  async function refreshRelayList(relays?: string[]): Promise<void> {
    try {
      // Clear current list
      relayList.innerHTML = '';
      
      // Get relays from main process if not provided
      if (!relays) {
        relays = await ipcRenderer.invoke('get-relays');
      }
      
      // Ensure relays is defined
      const relaysList = relays || [];
      
      if (relaysList.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.textContent = 'No relays configured';
        relayList.appendChild(emptyItem);
        return;
      }
      
      // Add relays to list
      relaysList.forEach((relay: string) => {
        const item = document.createElement('li');
        
        // Create relay text
        const relayText = document.createElement('span');
        relayText.textContent = relay;
        item.appendChild(relayText);
        
        // Create remove button
        const removeButton = document.createElement('button');
        removeButton.textContent = 'Remove';
        removeButton.className = 'remove-relay';
        removeButton.addEventListener('click', async () => {
          try {
            const updatedRelays = await ipcRenderer.invoke('remove-relay', relay);
            refreshRelayList(updatedRelays);
          } catch (error) {
            showError(error as Error);
          }
        });
        
        item.appendChild(removeButton);
        relayList.appendChild(item);
      });
    } catch (error) {
      showError(error as Error);
    }
  }
  
  // Helper function to display repositories
  function displayRepositories(repositories: any[]): void {
    // Clear current content
    repositoryBrowser.innerHTML = '';
    
    if (repositories.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'empty-message';
      emptyMessage.textContent = 'No repositories found';
      repositoryBrowser.appendChild(emptyMessage);
      return;
    }
    
    // Create repository list
    const repoList = document.createElement('ul');
    repoList.className = 'repository-list';
    
    repositories.forEach(repo => {
      const item = document.createElement('li');
      item.className = 'repository-item';
      
      // Repository name
      const nameElement = document.createElement('h3');
      nameElement.textContent = repo.name;
      item.appendChild(nameElement);
      
      // Repository author
      const authorElement = document.createElement('p');
      authorElement.textContent = `Author: ${repo.author}`;
      item.appendChild(authorElement);
      
      // Repository description (if available)
      if (repo.description) {
        const descriptionElement = document.createElement('p');
        descriptionElement.textContent = repo.description;
        item.appendChild(descriptionElement);
      }
      
      // Clone button
      const cloneButton = document.createElement('button');
      cloneButton.textContent = 'Clone';
      cloneButton.className = 'clone-repo-button';
      cloneButton.addEventListener('click', async () => {
        try {
          updateStatus(`Cloning repository ${repo.name}...`);
          
          await ipcRenderer.invoke('clone-repository-by-info', repo);
          
          // Refresh repository list
          await refreshRepositoryList();
          
        } catch (error) {
          showError(error as Error);
        }
      });
      
      item.appendChild(cloneButton);
      repoList.appendChild(item);
    });
    
    repositoryBrowser.appendChild(repoList);
  }
  
  // Initialize relay list
  refreshRelayList();

  // IPC Handlers
  ipcRenderer.on('repo-status', (_: IpcRendererEvent, message: string) => {
    updateStatus(message);
  });
  
  ipcRenderer.on('repo-error', (_: IpcRendererEvent, error: string) => {
    showError(error);
  });
  
  ipcRenderer.on('repo-metadata', (_: IpcRendererEvent, metadata: GitRepository & { manifest: TransferManifest }) => {
    updateRepoInfo(metadata);
    gitBridge.setTransferManifest(metadata.manifest);
  });

  ipcRenderer.on('repo-chunk', async (_: IpcRendererEvent, chunk: FileChunk) => {
    try {
      await gitBridge.receiveChunk(chunk);
      updateStatus(`Receiving chunk ${chunk.index + 1}/${chunk.totalChunks} for ${chunk.path}`);
      
      // Check if all files are transferred
      if (gitBridge.isTransferComplete()) {
        try {
          // Verify all files were transferred correctly
          const verification = await gitBridge.verifyTransfer();
          if (!verification.success) {
            console.error('Transfer verification failed:', verification.errors);
            updateStatus(`Transfer verification failed: ${verification.errors.join(', ')}`);
            return;
          }

          console.log('Transfer verification successful');
          updateStatus('Transfer verification successful, reading repository...');

          // Now try to read the repository state
          const repo = await gitBridge.getRepository(currentRepoPath);
          updateRepoInfo(repo);
          
          // Build directory tree
          if (gitBridge.transferManifest) {
            repoFiles = gitBridge.transferManifest.files;
            buildDirectoryTree(repoFiles);
          }
          
          updateStatus('Repository transfer complete!');
        } catch (error) {
          console.error('Error after transfer:', error);
          updateStatus(`Error after transfer: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('Error receiving chunk:', error);
      updateStatus(`Error receiving chunk: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

  ipcRenderer.on('repo-transfer-complete', () => {
    updateStatus('Repository transfer complete!');
    
    // Build directory tree if we have files
    if (repoFiles.length > 0) {
      buildDirectoryTree(repoFiles);
    }
  });
});
