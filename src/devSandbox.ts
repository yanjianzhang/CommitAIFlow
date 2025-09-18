import * as fs from 'fs/promises';
import * as path from 'path';
import * as cp from 'child_process';
import { promisify } from 'util';

const execFile = promisify(cp.execFile);

async function run(cmd: string, args: string[], cwd: string) {
  try {
    await execFile(cmd, args, { cwd });
  } catch (err: any) {
    const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
    const stdout = typeof err?.stdout === 'string' ? err.stdout : '';
    const msg = stderr || stdout || String(err?.message || err);
    throw new Error(`${cmd} ${args.join(' ')} failed: ${msg}`);
  }
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export interface SandboxResult {
  repoPath: string;
  changedFile: string;
}

export async function ensureSandboxRepo(baseDir: string): Promise<string> {
  const repoPath = path.join(baseDir, 'sandbox-repo');
  const gitDir = path.join(repoPath, '.git');
  if (!(await pathExists(repoPath))) {
    await fs.mkdir(repoPath, { recursive: true });
  }
  if (!(await pathExists(gitDir))) {
    await run('git', ['init', '-b', 'main'], repoPath);
    // Local identity to avoid relying on global config
    await run('git', ['config', 'user.name', 'CommitAIFlow Dev'], repoPath);
    await run('git', ['config', 'user.email', 'dev@example.com'], repoPath);
    const readme = path.join(repoPath, 'README.md');
    await fs.writeFile(readme, '# CommitAIFlow Sandbox\n\nThis is an isolated Git repo for developing CommitAIFlow.\n');
    await run('git', ['add', '-A'], repoPath);
    await run('git', ['commit', '-m', 'chore: initial sandbox setup'], repoPath);
  }
  return repoPath;
}

export async function makeSyntheticChange(repoPath: string): Promise<SandboxResult> {
  const file = path.join(repoPath, 'sandbox.txt');
  const now = new Date().toISOString();
  const stamp = `update ${now}`;
  let content = '';
  try {
    content = await fs.readFile(file, 'utf8');
  } catch {
    // ignore
  }
  const prefix = content ? content.replace(/\n?$/, '\n') : '';
  await fs.writeFile(file, `${prefix}${stamp}\n`, 'utf8');
  await run('git', ['add', '-A'], repoPath);
  return { repoPath, changedFile: file };
}

