import * as cp from 'child_process';
import * as http from 'http';

export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder';

export interface OllamaRunOptions {
  model?: string;
  timeoutMs?: number;
}

function httpGet(url: string, timeoutMs = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

async function isOllamaUp(): Promise<boolean> {
  try { return !!(await httpGet('http://localhost:11434/api/tags', 1000)); }
  catch { return false; }
}

function run(cmd: string, args: string[], detached = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { stdio: detached ? 'ignore' : 'pipe', detached });
    p.on('error', reject);
    if (detached) { p.unref(); resolve(); }
    else { p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))); }
  });
}

export async function ensureOllamaRunning(verbose = false): Promise<void> {
  if (await isOllamaUp()) return;

  try { await run('brew', ['services', 'start', 'ollama']); }
  catch (e) { if (verbose) console.warn('[Ollama] brew start failed:', e); }

  if (await isOllamaUp()) return;

  try { await run('ollama', ['serve'], true); }
  catch (e) { throw new Error(`Cannot spawn 'ollama serve': ${String(e)}`); }

  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 700));
    if (await isOllamaUp()) return;
  }
  throw new Error('Ollama not responding on http://localhost:11434');
}

export async function runOllama(prompt: string, options: OllamaRunOptions = {}): Promise<string> {
  const { model = DEFAULT_OLLAMA_MODEL, timeoutMs = 60_000 } = options;
  await ensureOllamaRunning();

  return new Promise((resolve, reject) => {
    const child = cp.spawn('ollama', ['run', model], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ollama run timed out after ${timeoutMs}ms`));
    }, timeoutMs) : undefined;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) return reject(err);
      resolve(stdout);
    };

    child.on('error', err => {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        finish(new Error("'ollama' executable not found in PATH."));
        return;
      }
      finish(error);
    });
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', code => {
      if (code === 0) {
        finish();
      } else {
        const message = stderr.trim() || stdout.trim();
        finish(new Error(message || `ollama run exited with code ${code}`));
      }
    });

    child.stdin.end(prompt);
  });
}
