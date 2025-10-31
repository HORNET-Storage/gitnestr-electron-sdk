/**
 * Utility to find the gitnestr executable
 * Checks if gitnestr is available in the system PATH first,
 * then falls back to the local bin directory
 */

const { execaSync } = await import('execa');
import * as path from 'path';
import * as fs from 'fs';

let cachedGitnestrPath: string | null = null;

/**
 * Find the gitnestr executable path
 * @param projectRoot Optional project root directory to check for local binary
 * @returns The path to the gitnestr executable
 */
export async function findGitnestrPath(projectRoot?: string): Promise<string> {
  // Return cached path if already found
  if (cachedGitnestrPath) {
    return cachedGitnestrPath;
  }

  // First, try to find gitnestr in the system PATH
  const systemGitnestr = await findInSystemPath();
  if (systemGitnestr) {
    cachedGitnestrPath = systemGitnestr;
    return systemGitnestr;
  }

  // Fall back to local binary
  const localBinary = getLocalBinaryPath(projectRoot);
  if (fs.existsSync(localBinary)) {
    cachedGitnestrPath = localBinary;
    return localBinary;
  }

  // If neither found, return the default local path
  // This allows the error to be caught when actually trying to execute
  cachedGitnestrPath = localBinary;
  return localBinary;
}

/**
 * Find gitnestr in the system PATH
 * @returns The path to gitnestr if found, null otherwise
 */
async function findInSystemPath(): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'where' : 'which';
  const binaryName = isWindows ? 'gitnestr.exe' : 'gitnestr';

  try {
    // Try to find the binary using which/where
    const result = execaSync(command, [binaryName], {
      stdio: 'pipe',
      reject: false
    });

    if (result.exitCode === 0 && result.stdout) {
      // On Windows, 'where' might return multiple paths, take the first one
      const paths = result.stdout.trim().split('\n');
      const firstPath = paths[0].trim();

      // Verify the file exists
      if (fs.existsSync(firstPath)) {
        console.log(`[GitnestrBridge] Found gitnestr in system PATH: ${firstPath}`);
        return firstPath;
      }
    }
  } catch (error) {
    // Command not found or other error, continue to fallback
    console.log('[GitnestrBridge] gitnestr not found in system PATH, will use local binary');
  }

  return null;
}

/**
 * Get the local binary path based on the project root
 * @param projectRoot Optional project root directory
 * @returns The path to the local binary
 */
function getLocalBinaryPath(projectRoot?: string): string {
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? 'gitnestr.exe' : 'gitnestr';

  if (projectRoot) {
    return path.join(projectRoot, 'bin', binaryName);
  }

  // Default to relative path from current directory
  return path.join('bin', binaryName);
}

/**
 * Clear the cached gitnestr path
 * Useful for testing or when the binary location might have changed
 */
export function clearGitnestrCache(): void {
  cachedGitnestrPath = null;
}

/**
 * Synchronous version of findGitnestrPath for use in constructors
 * Note: This won't check the system PATH, only the local binary
 * Use the async version for full functionality
 */
export function findGitnestrPathSync(projectRoot?: string): string {
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? 'gitnestr.exe' : 'gitnestr';

  if (projectRoot) {
    return path.join(projectRoot, 'bin', binaryName);
  }

  return path.join('bin', binaryName);
}
