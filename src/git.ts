import * as cp from 'child_process';
import { promisify } from 'util';

const execFile = promisify(cp.execFile);
const DEFAULT_MAX_BUFFER = 1_024 * 1_024; // 1 MB

async function runGit(args: string[], cwd: string, maxBuffer = DEFAULT_MAX_BUFFER): Promise<{ stdout: string; stderr: string; }> {
  try {
    return await execFile('git', args, { cwd, maxBuffer });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; };
    if (err.code === 'ENOENT') {
      throw new Error('Git executable not found in PATH.');
    }
    const stderr = typeof err.stderr === 'string' && err.stderr.trim() ? err.stderr.trim() : '';
    const stdout = typeof err.stdout === 'string' && err.stdout.trim() ? err.stdout.trim() : '';
    const message = stderr || stdout || err.message || `Git command failed: git ${args.join(' ')}`;
    throw new Error(message);
  }
}

export interface DiffResult {
  diff: string;
  truncated: boolean;
}

export async function getStagedDiff(cwd: string, limit = 100_000): Promise<DiffResult> {
  const { stdout } = await runGit(['diff', '--cached', '--unified=0'], cwd);
  if (!stdout) {
    return { diff: '', truncated: false };
  }
  const truncated = stdout.length > limit;
  return {
    diff: truncated ? stdout.slice(0, limit) : stdout,
    truncated,
  };
}

export async function getShortStatus(cwd: string): Promise<string> {
  const { stdout } = await runGit(['status', '--short'], cwd);
  return stdout.trim();
}

export async function hasStagedChanges(cwd: string): Promise<boolean> {
  try {
    await runGit(['diff', '--cached', '--quiet'], cwd);
    return false;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // git diff --cached --quiet exits with 1 when there are staged changes
    if (typeof err.code === 'number' && err.code === 1) {
      return true;
    }
    const message = (err.message || '').trim();
    if (message.includes('exit code 1')) {
      return true;
    }
    if (message.toLowerCase().includes('not a git repository')) {
      throw new Error('Not a Git repository.');
    }
    throw new Error(`Unable to inspect staged changes: ${message || 'unknown error'}`);
  }
}
