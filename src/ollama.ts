import * as cp from 'child_process';
import * as http from 'http';

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