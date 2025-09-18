import * as vscode from 'vscode';

import { generateCommitMessage, generateCommitMessageFromDiff, DIFF_LIMIT } from './commitMessage';
import { getStagedDiff, hasStagedChanges } from './git';

export const GIT_GRAPH_CONTAINER_ID = 'commitaiflow-gitflow';
export const GIT_GRAPH_VIEW_ID = 'commitaiflow-gitgraph';

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = GIT_GRAPH_VIEW_ID;

  private host: GitGraphWebviewHost | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true }; // retain basic capabilities
    this.disposeHost();
    this.host = new GitGraphWebviewHost(this.context, webviewView.webview);
    webviewView.onDidDispose(() => this.disposeHost());
  }

  private disposeHost(): void {
    if (this.host) {
      this.host.dispose();
      this.host = undefined;
    }
  }
}

export async function showGitGraph(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'gitGraph',
    'Git Commit Flow (Preview)',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const host = new GitGraphWebviewHost(context, panel.webview);
  context.subscriptions.push(host);
  panel.onDidDispose(() => host.dispose());
}

class GitGraphWebviewHost implements vscode.Disposable {
  private isGenerating = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly webview: vscode.Webview) {
    console.log('[CommitAIFlow][GitGraph] Initializing webview host');
    const html = getWebviewHtml(this.context, this.webview);
    const hasPlaceholder = html.includes('${');
    const around = (() => {
      const i = html.indexOf('const DIFF_CHAR_LIMIT');
      return i >= 0 ? html.slice(i, i + 80) : '';
    })();
    console.log('[CommitAIFlow][GitGraph] html has ${ ? ', hasPlaceholder, ' around DIFF limit: ', around);
    this.webview.html = html;
    this.disposables.push(
      this.webview.onDidReceiveMessage(message => {
        console.log('[CommitAIFlow][GitGraph] onDidReceiveMessage:', message);
        void this.handleMessage(message);
      })
    );
  }

  dispose(): void {
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      try {
        disposable?.dispose();
      } catch (error) {
        console.warn('[CommitAIFlow] Failed to dispose GitGraph disposable:', error);
      }
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || typeof (message as any).type !== 'string') {
      console.warn('[CommitAIFlow][GitGraph] Ignoring invalid message', message);
      return;
    }

    const { type } = message as { type: string };

    switch (type) {
      case 'generate-commit-message':
        console.log('[CommitAIFlow][GitGraph] handle generate-commit-message');
        await this.handleGenerateCommitMessage();
        break;
      case 'generate-commit-message-from-diff':
        console.log('[CommitAIFlow][GitGraph] handle generate-commit-message-from-diff');
        await this.handleGenerateCommitMessageFromDiff(message as { diff?: string });
        break;
      case 'load-staged-diff':
        console.log('[CommitAIFlow][GitGraph] handle load-staged-diff');
        await this.handleLoadStagedDiff();
        break;
      default:
        console.warn('[CommitAIFlow][GitGraph] Unknown message type:', type);
        break;
    }
  }

  private async handleGenerateCommitMessage(): Promise<void> {
    if (this.isGenerating) {
      return;
    }

    const workspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!workspace) {
      console.warn('[CommitAIFlow][GitGraph] No workspace folder.');
      await this.webview.postMessage({ type: 'error', error: 'Open a workspace folder with a Git repository.' });
      return;
    }

    this.isGenerating = true;
    try {
      const result = await vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Notification,
          title: 'Generating commit message with Ollama...'
        },
        () => generateCommitMessage(workspace.uri.fsPath)
      );
      console.log('[CommitAIFlow][GitGraph] commitMessage payload size', JSON.stringify(result).length);
      await this.webview.postMessage({ type: 'commitMessage', payload: result });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error('[CommitAIFlow][GitGraph] generate failed:', messageText);
      await this.webview.postMessage({ type: 'error', error: messageText });
      vscode.window.showErrorMessage(`Commit message generation failed: ${messageText}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private async handleGenerateCommitMessageFromDiff(message: { diff?: string }): Promise<void> {
    if (this.isGenerating) {
      return;
    }

    const diffText = typeof message.diff === 'string' ? message.diff : '';
    if (!diffText.trim()) {
      console.warn('[CommitAIFlow][GitGraph] Provided diff is empty.');
      await this.webview.postMessage({ type: 'error', error: 'Provide a diff before generating a test message.' });
      return;
    }

    this.isGenerating = true;
    try {
      const result = await vscode.window.withProgress(
        {
          cancellable: false,
          location: vscode.ProgressLocation.Notification,
          title: 'Generating commit message from provided diff...'
        },
        () => generateCommitMessageFromDiff(diffText)
      );
      console.log('[CommitAIFlow][GitGraph] commitMessage-from-diff payload size', JSON.stringify(result).length);
      await this.webview.postMessage({ type: 'commitMessage', payload: result });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error('[CommitAIFlow][GitGraph] generate-from-diff failed:', messageText);
      await this.webview.postMessage({ type: 'error', error: messageText });
      vscode.window.showErrorMessage(`Commit message generation failed: ${messageText}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private async handleLoadStagedDiff(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!workspace) {
      console.warn('[CommitAIFlow][GitGraph] No workspace for load-staged-diff');
      await this.webview.postMessage({
        type: 'diff',
        payload: {
          diff: '',
          truncated: false,
          context: 'staged',
          status: 'Open a workspace folder with a Git repository.',
          kind: 'error'
        }
      });
      vscode.window.showErrorMessage('Open a workspace folder with a Git repository to load staged diff.');
      return;
    }

    try {
      const hasChanges = await hasStagedChanges(workspace.uri.fsPath);
      console.log('[CommitAIFlow][GitGraph] hasStagedChanges =', hasChanges, 'cwd=', workspace.uri.fsPath);
      if (!hasChanges) {
        await this.webview.postMessage({
          type: 'diff',
          payload: {
            diff: '',
            truncated: false,
            context: 'staged',
            status: 'No staged changes found.',
            kind: 'error'
          }
        });
        return;
      }

      const { diff, truncated } = await getStagedDiff(workspace.uri.fsPath, DIFF_LIMIT);
      console.log('[CommitAIFlow][GitGraph] staged diff length', diff.length, 'truncated', truncated);
      await this.webview.postMessage({
        type: 'diff',
        payload: {
          diff,
          truncated,
          context: 'staged',
          status: truncated ? `Staged diff loaded (truncated to ${DIFF_LIMIT} characters).` : 'Staged diff loaded.',
          kind: 'ok'
        }
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      console.error('[CommitAIFlow][GitGraph] load-staged-diff failed:', messageText);
      await this.webview.postMessage({
        type: 'diff',
        payload: {
          diff: '',
          truncated: false,
          context: 'staged',
          status: `Failed to load staged diff: ${messageText}`,
          kind: 'error'
        }
      });
      vscode.window.showErrorMessage(`Failed to load staged diff: ${messageText}`);
    }
  }
}

function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const nonce = getNonce();

  // Build CSP then inject via placeholder to avoid raw ${...} in template literal
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    "font-src 'none'",
  ].join('; ');

  const html = /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="%%CSP%%" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Commit Flow</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
      h2 { margin: 0; font-size: 20px; }
      .card { background: var(--vscode-editor-background, rgba(120,120,120,0.06)); border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.12)); border-radius: 10px; padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
      button { padding: 6px 12px; font-size: 13px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background, #007acc); color: var(--vscode-button-foreground, #fff); cursor: pointer; }
      button:hover { filter: brightness(1.05); }
      button[disabled] { opacity: 0.5; cursor: not-allowed; }
      .muted { color: var(--vscode-descriptionForeground, #777); }
      textarea { width: 100%; min-height: 140px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; padding: 8px; border-radius: 6px; border: 1px solid var(--vscode-input-border, rgba(0,0,0,0.1)); resize: vertical; }
      .controls { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
      .status { font-size: 12px; }
      .status--busy { color: var(--vscode-descriptionForeground, #666); }
      .status--ok { color: var(--vscode-debugTokenExpression-name, #4caf50); }
      .status--error { color: var(--vscode-errorForeground, #f14c4c); }
      .meta { font-size: 12px; color: var(--vscode-descriptionForeground, #666); margin-top: 8px; white-space: pre-line; }
      .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--vscode-progressBar-background, rgba(0, 122, 204, 0.35)); border-top-color: var(--vscode-progressBar-background, #007acc); animation: spin 1s linear infinite; display: none; }
      .spinner.is-visible { display: inline-block; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Diff Styles */
      .diff-input { min-height: 120px; padding: 12px; background: var(--vscode-editor-background, rgba(120,120,120,0.04)); }
      .diff-container { margin-top: 10px; border: 1px solid var(--vscode-input-border, rgba(0,0,0,0.1)); border-radius: 6px; overflow: hidden; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; }
      .diff-row { display: grid; grid-template-columns: 52px 52px 1fr; align-items: stretch; }
      .no-linenos .diff-row { grid-template-columns: 0px 0px 1fr; }
      .ln { user-select: none; text-align: right; padding: 2px 8px; color: var(--vscode-descriptionForeground, #8a8a8a); border-right: 1px solid var(--vscode-input-border, rgba(0,0,0,0.06)); }
      .no-linenos .ln { display: none; }
      .code { white-space: pre; padding: 2px 8px; }
      .diff-row.added .code { background: #e6ffec; color: #116329; }
      .diff-row.removed .code { background: #ffebe9; color: #cf222e; }
      .diff-row.context .code { background: transparent; }
      .diff-row.meta .code { background: transparent; color: var(--vscode-descriptionForeground, #777); }
      .diff-row:hover .code { filter: brightness(0.97); }
      .diff-row.collapsed .code { background: transparent; }
      .expand-btn { font-size: 12px; padding: 2px 8px; }
    </style>
  </head>
  <body data-diff-limit="%%DIFF_LIMIT%%">
    <header>
      <h2>Git Commit Flow (Preview)</h2>
      <p>Graph rendering is coming soon. For now, generate an AI-assisted commit message for staged changes.</p>
    </header>
    <section>
      <h3 style="margin-top: 0">AI Commit Message Assistant</h3>
      <p>Generate a Conventional Commits style message for the currently staged diff.</p>
      <div class="controls">
        <button id="generateBtn">Generate Commit Message</button>
        <button id="copyBtn" disabled>Copy</button>
        <span id="progressSpinner" class="spinner" aria-hidden="true"></span>
        <span class="status" id="status" role="status"></span>
      </div>
      <textarea id="result" placeholder="Generated message will appear here" readonly></textarea>
      <details id="rawWrapper" style="margin-top: 8px;">
        <summary>Model output (raw)</summary>
        <pre id="rawOutput" style="white-space: pre-wrap; font-family: inherit; font-size: 12px; background: transparent; padding: 8px 0; margin: 0;"></pre>
      </details>
      <div class="meta" id="meta"></div>
    </section>

    <section class="card">
      <h3 style="margin-top: 0">Diff Sandbox</h3>
      <p class="muted">Inspect staged changes or test a custom diff with GitHub-style highlighting.</p>
      <div class="controls">
        <button id="loadDiffBtn">Load Staged Diff</button>
        <button id="sampleDiffBtn">Insert Sample Diff</button>
        <button id="generateFromDiffBtn">Generate From Diff</button>
        <span style="flex:1"></span>
        <label style="display:flex; align-items:center; gap:6px">
          <input type="checkbox" id="toggleLineNumbers" checked /> Line numbers
        </label>
        <label style="display:flex; align-items:center; gap:6px">
          <input type="checkbox" id="toggleCollapse" checked /> Collapse unchanged
        </label>
      </div>
      <textarea id="diffInput" class="diff-input" spellcheck="false" placeholder="Diff source (editable)"></textarea>
      <div id="diffPreview" class="diff-container" aria-label="Diff preview"></div>
      <div class="meta" id="diffMeta"></div>
      <details style="margin-top:8px;">
        <summary>Debug Log</summary>
        <pre id="debugOutput" style="white-space: pre-wrap; font-size: 12px; line-height: 1.35; margin: 6px 0 0; max-height: 180px; overflow: auto;"></pre>
      </details>
    </section>

    <script nonce="__NONCE__">
      const diffPreview = document.getElementById('diffPreview');
      const toggleLineNumbers = document.getElementById('toggleLineNumbers');
      const toggleCollapse = document.getElementById('toggleCollapse');
      if (!progressSpinner) {
        throw new Error('Progress spinner element missing.');
      }
      const debugOutput = document.getElementById('debugOutput');
      function dbg(msg) {
        const t = new Date().toISOString();
        const line = '[webview ' + t + '] ' + msg;
        try { console.log(line); } catch {}
        if (debugOutput) {
          debugOutput.textContent += (debugOutput.textContent ? '\n' : '') + line;
          debugOutput.scrollTop = debugOutput.scrollHeight;
        }
      }
      dbg('Webview script loaded');

      const SAMPLE_DIFF_LINES = [
        'diff --git a/src/example.ts b/src/example.ts',
        'index a1b2c3d..e4f5a6b 100644',
        '--- a/src/example.ts',
        '+++ b/src/example.ts',
        '@@ -1,6 +1,10 @@',
        "-import { compute } from './math';",
        "-",
        "-export function add(a: number, b: number) {",
        "-  return compute(a + b);",
        "-}",
        "+export function add(a: number, b: number) {",
        '+  const result = a + b;',
        '+  return result;',
        '+}',
        '+',
        '+export function multiply(a: number, b: number) {',
        '+  return a * b;',
        '+}'
      ];
      const SAMPLE_DIFF = SAMPLE_DIFF_LINES.join('\n');

      function setStatus(text, kind) {
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (kind ? ' status--' + kind : '');
      }

      function showSpinner(visible) {
        if (visible) {
          progressSpinner.classList.add('is-visible');
          progressSpinner.setAttribute('aria-hidden', 'false');
        } else {
          progressSpinner.classList.remove('is-visible');
          progressSpinner.setAttribute('aria-hidden', 'true');
        }
      }

      function setGenerateButtonsDisabled(disabled) {
        generateBtn.disabled = disabled;
        if (generateFromDiffBtn) {
          generateFromDiffBtn.disabled = disabled;
        }
      }

      function resetOutputs() {
        resultEl.value = '';
        metaEl.textContent = '';
        rawOutput.textContent = '';
        rawWrapper.open = false;
        rawWrapper.style.display = 'none';
        copyBtn.disabled = true;
      }

      function beginGeneration(statusText) {
        resetOutputs();
        setStatus(statusText, 'busy');
        setGenerateButtonsDisabled(true);
        showSpinner(true);
      }

      function finishGeneration() {
        setGenerateButtonsDisabled(false);
        showSpinner(false);
      }

      function buildDiffMeta(payload) {
        const lines = [];
        const ctxSource = payload && (payload.context !== undefined ? payload.context : payload.source);
        if (ctxSource === 'staged') {
          lines.push('Source: staged changes');
        } else if (ctxSource === 'custom') {
          lines.push('Source: custom diff');
        } else if (typeof ctxSource === 'string' && ctxSource.trim()) {
          lines.push('Source: ' + ctxSource);
        }
        const truncatedValue = payload ? (payload.truncated !== undefined ? payload.truncated : payload.truncatedDiff) : undefined;
        const truncated = Boolean(truncatedValue);
        if (truncated) {
          lines.push('Note: Diff truncated to ' + DIFF_CHAR_LIMIT + ' characters before sending to the model.');
        }
        if (payload && payload.note) {
          lines.push(payload.note);
        }
        return lines.join('\n');
      }

      function updateDiffArea(payload) {
        if (payload && typeof payload.diff === 'string') {
          diffInput.value = payload.diff;
          diffInput.scrollTop = 0;
        }
        diffMeta.textContent = buildDiffMeta(payload);
        renderDiff();
      }

      function handleDiffResponse(payload) {
        updateDiffArea(payload);
        const diffText = payload && typeof payload.diff === 'string' ? payload.diff : diffInput.value;
        const hasDiff = diffText.trim().length > 0;
        const statusText = payload && typeof payload.status === 'string'
          ? payload.status
          : hasDiff
            ? 'Diff loaded.'
            : 'No diff returned.';
        const statusKind = payload && payload.kind ? payload.kind : (hasDiff ? 'ok' : 'error');
        setStatus(statusText, statusKind);
      }

      generateBtn.addEventListener('click', () => {
        dbg('Clicked: generate-commit-message');
        beginGeneration('Generating commit message from staged changes...');
        vscode.postMessage({ type: 'generate-commit-message' });
      });

      if (generateFromDiffBtn) {
        generateFromDiffBtn.addEventListener('click', () => {
          const diffText = diffInput.value || '';
          if (!diffText.trim()) {
            setStatus('Enter or load a diff before generating.', 'error');
            return;
          }
          dbg('Clicked: generate-commit-message-from-diff, length=' + diffText.length);
          beginGeneration('Generating commit message from diff...');
          vscode.postMessage({ type: 'generate-commit-message-from-diff', diff: diffText });
        });
      }

      if (loadDiffBtn) {
        loadDiffBtn.addEventListener('click', () => {
          dbg('Clicked: load-staged-diff');
          setStatus('Loading staged diff...', 'busy');
          vscode.postMessage({ type: 'load-staged-diff' });
        });
      }

      if (sampleDiffBtn) {
        sampleDiffBtn.addEventListener('click', () => {
          updateDiffArea({ diff: SAMPLE_DIFF, context: 'custom', note: 'Sample diff inserted. Edit before generating.' });
          setStatus('Sample diff inserted. Edit before generating.', 'ok');
          dbg('Inserted sample diff, length=' + SAMPLE_DIFF.length);
        });
      }

      // --- Diff rendering (GitHub-like colors + optional line numbers + collapse) ---
      const COLLAPSE_THRESHOLD = 20;
      let renderTimer;

      diffInput.addEventListener('input', () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderDiff, 150);
      });
      if (toggleLineNumbers) toggleLineNumbers.addEventListener('change', renderDiff);
      if (toggleCollapse) toggleCollapse.addEventListener('change', renderDiff);

      function renderDiff() {
        if (!diffPreview) return;
        const text = (diffInput.value || '').replace(/\r\n/g, '\n');
        const showNums = toggleLineNumbers && toggleLineNumbers.checked;
        const collapse = !toggleCollapse || toggleCollapse.checked;
        dbg('Render diff: length=' + text.length + ', showNums=' + showNums + ', collapse=' + collapse);
        diffPreview.innerHTML = '';
        diffPreview.classList.toggle('no-linenos', !showNums);

        let hunks = [];
        try { hunks = parseUnifiedDiff(text); }
        catch (e) { dbg('parseUnifiedDiff error: ' + (e && e.message ? e.message : String(e))); }
        dbg('Parsed hunks=' + hunks.length);
        for (const h of hunks) {
          // file headers, meta
          for (const metaLine of h.meta) {
            addRow({ kind: 'meta', oldNo: '', newNo: '', text: metaLine });
          }

          const ctxRuns = [];
          let run = [];
          const flushRun = () => { if (run.length) { ctxRuns.push(run); run = []; } };

          for (const ln of h.lines) {
            if (ln.kind === 'ctx') { run.push(ln); }
            else { flushRun(); addRow(ln); }
          }
          flushRun();

          for (const group of ctxRuns) {
            if (collapse && group.length > COLLAPSE_THRESHOLD) {
              const head = group.slice(0, 3);
              const tail = group.slice(-3);
              for (const ln of head) addRow(ln);
              const hidden = group.slice(3, -3);
              addCollapsed(hidden.length, hidden);
              for (const ln of tail) addRow(ln);
            } else {
              for (const ln of group) addRow(ln);
            }
          }
        }
      }

      function addCollapsed(count, hiddenLines) {
        const row = document.createElement('div');
        row.className = 'diff-row collapsed';
        const lnOld = document.createElement('div'); lnOld.className = 'ln old'; lnOld.textContent = '';
        const lnNew = document.createElement('div'); lnNew.className = 'ln new'; lnNew.textContent = '';
        const code = document.createElement('div'); code.className = 'code context';
        const btn = document.createElement('button');
        btn.textContent = 'Expand ' + count + ' lines';
        btn.className = 'expand-btn';
        btn.addEventListener('click', () => {
          row.replaceWith(...hiddenLines.map(h => createRow(h)));
        });
        code.appendChild(btn);
        row.appendChild(lnOld); row.appendChild(lnNew); row.appendChild(code);
        diffPreview.appendChild(row);
      }

      function addRow(ln) { diffPreview.appendChild(createRow(ln)); }

      function createRow(ln) {
        const row = document.createElement('div');
        row.className = 'diff-row ' + (ln.kind === 'add' ? 'added' : ln.kind === 'del' ? 'removed' : ln.kind === 'meta' ? 'meta' : 'context');
        const lnOld = document.createElement('div'); lnOld.className = 'ln old'; lnOld.textContent = ln.oldNo === undefined ? '' : String(ln.oldNo || '');
        const lnNew = document.createElement('div'); lnNew.className = 'ln new'; lnNew.textContent = ln.newNo === undefined ? '' : String(ln.newNo || '');
        const code = document.createElement('div'); code.className = 'code'; code.textContent = ln.text;
        row.appendChild(lnOld); row.appendChild(lnNew); row.appendChild(code);
        return row;
      }

      function parseUnifiedDiff(text) {
        const lines = text.split('\n');
        const hunks = [];
        let i = 0;
        let cur = null;
        let oldNo = 0, newNo = 0;
        while (i < lines.length) {
          const line = lines[i++];
          if (line.startsWith('@@')) {
            const m = /@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/.exec(line);
            if (m) { oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10); }
            if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
            cur.meta.push(line);
            continue;
          }
          if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
            if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
            cur.meta.push(line);
            continue;
          }
          if (!cur) { cur = { meta: [], lines: [] }; hunks.push(cur); }
          if (line.startsWith('+')) {
            cur.lines.push({ kind: 'add', oldNo: '', newNo: newNo++, text: line });
          } else if (line.startsWith('-')) {
            cur.lines.push({ kind: 'del', oldNo: oldNo++, newNo: '', text: line });
          } else if (line.startsWith(' ') || line === '') {
            cur.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line || ' ' });
          } else if (line.startsWith('\\')) { // \ No newline at end of file
            cur.lines.push({ kind: 'meta', oldNo: '', newNo: '', text: line });
          } else {
            cur.lines.push({ kind: 'ctx', oldNo: '', newNo: '', text: line });
          }
        }
        return hunks;
      }

      copyBtn.addEventListener('click', async () => {
        if (!resultEl.value) {
          return;
        }
        try {
          await navigator.clipboard.writeText(resultEl.value);
          setStatus('Copied to clipboard', 'ok');
        } catch (error) {
          console.error(error);
          setStatus('Copy failed', 'error');
        }
      });

      window.addEventListener('message', event => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }
        dbg('Received message from host: ' + message.type);

        if (message.type === 'commitMessage') {
          const payload = message.payload;
          if (!payload || typeof payload !== 'object') {
            finishGeneration();
            setStatus('Malformed response from extension.', 'error');
            copyBtn.disabled = true;
            return;
          }
          const messageText = typeof payload.message === 'string' ? payload.message : '';
          const rawText = typeof payload.raw === 'string' ? payload.raw : '';
          const source = typeof payload.source === 'string' ? payload.source : 'unknown';
          const model = typeof payload.model === 'string' ? payload.model : 'unknown';
          const truncated = Boolean(payload.truncatedDiff);

          resultEl.value = messageText;
          rawOutput.textContent = rawText;
          rawWrapper.style.display = rawText ? 'block' : 'none';
          rawWrapper.open = false;
          copyBtn.disabled = !messageText;

          if (typeof payload.diff === 'string') {
            updateDiffArea({ diff: payload.diff, truncated: payload.truncatedDiff, context: payload.context });
          } else if (payload.context) {
            updateDiffArea({ context: payload.context, truncated: payload.truncatedDiff });
          }

          const metaLines = [];
          if (source === 'fallback') {
            metaLines.push('Fallback message used (model output was empty).');
          } else {
            metaLines.push('Generated with model: ' + model);
          }
          if (truncated) {
            metaLines.push('Warning: Diff truncated to ' + DIFF_CHAR_LIMIT + ' characters before sending to the model.');
          }
          metaEl.textContent = metaLines.join('\n');

          if (rawText) {
            rawWrapper.open = source === 'fallback';
          }

          setStatus('Generated with ' + model, source === 'fallback' ? 'busy' : 'ok');
          finishGeneration();
          return;
        }

        if (message.type === 'diff') {
          handleDiffResponse(message.payload || {});
          return;
        }

        if (message.type === 'error') {
          setStatus(message.error || 'Unexpected error', 'error');
          finishGeneration();
          copyBtn.disabled = true;
          metaEl.textContent = '';
          rawWrapper.style.display = 'none';
          rawOutput.textContent = '';
          return;
        }
      });

      rawWrapper.style.display = 'none';
      showSpinner(false);
      diffMeta.textContent = 'Load staged changes or insert a sample diff to get started.';
    </script>
    <script nonce="__NONCE__" src="%%SCRIPT_URI%%"></script>
  </body>
</html>`;
  // Replace placeholders to avoid `${}` in the template literal content
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return html
    .replace(/__NONCE__/g, nonce)
    .replace(/%%DIFF_LIMIT%%/g, String(DIFF_LIMIT))
    .replace('%%CSP%%', escapeAttr(csp))
    .replace('%%SCRIPT_URI%%', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'gitGraphView.js')).toString())
    .replace(/<\/script>/g, '<\\/script>');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
