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
    this.webview.html = getWebviewHtml(this.webview);
    this.disposables.push(
      this.webview.onDidReceiveMessage(message => {
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
      return;
    }

    const { type } = message as { type: string };

    switch (type) {
      case 'generate-commit-message':
        await this.handleGenerateCommitMessage();
        break;
      case 'generate-commit-message-from-diff':
        await this.handleGenerateCommitMessageFromDiff(message as { diff?: string });
        break;
      case 'load-staged-diff':
        await this.handleLoadStagedDiff();
        break;
      default:
        break;
    }
  }

  private async handleGenerateCommitMessage(): Promise<void> {
    if (this.isGenerating) {
      return;
    }

    const workspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!workspace) {
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
      await this.webview.postMessage({ type: 'commitMessage', payload: result });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
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
      await this.webview.postMessage({ type: 'commitMessage', payload: result });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.webview.postMessage({ type: 'error', error: messageText });
      vscode.window.showErrorMessage(`Commit message generation failed: ${messageText}`);
    } finally {
      this.isGenerating = false;
    }
  }

  private async handleLoadStagedDiff(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!workspace) {
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

function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Git Commit Flow</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
      h2 { margin: 0; font-size: 20px; }
      section { background: var(--vscode-editor-background, rgba(120,120,120,0.08)); border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.12)); border-radius: 8px; padding: 16px; }
      button { padding: 6px 12px; font-size: 13px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground, #007acc); color: var(--vscode-button-secondaryForeground, #fff); cursor: pointer; }
      button[disabled] { opacity: 0.5; cursor: not-allowed; }
      textarea { width: 100%; min-height: 140px; font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-input-border, rgba(0,0,0,0.1)); resize: vertical; }
      .controls { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
      .status { font-size: 12px; }
      .status--busy { color: var(--vscode-descriptionForeground, #666); }
      .status--ok { color: var(--vscode-debugTokenExpression-name, #4caf50); }
      .status--error { color: var(--vscode-errorForeground, #f14c4c); }
      .meta { font-size: 12px; color: var(--vscode-descriptionForeground, #666); margin-top: 8px; white-space: pre-line; }
      .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--vscode-progressBar-background, rgba(0, 122, 204, 0.35)); border-top-color: var(--vscode-progressBar-background, #007acc); animation: spin 1s linear infinite; display: none; }
      .spinner.is-visible { display: inline-block; }
      .diff-input { min-height: 220px; padding: 12px; background: var(--vscode-editor-background, rgba(120,120,120,0.04)); }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
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

    <section>
      <h3 style="margin-top: 0">Diff Sandbox</h3>
      <p>Inspect staged changes or test a custom diff before generating commit messages.</p>
      <div class="controls">
        <button id="loadDiffBtn">Load Staged Diff</button>
        <button id="sampleDiffBtn">Insert Sample Diff</button>
        <button id="generateFromDiffBtn">Generate From Diff</button>
      </div>
      <textarea id="diffInput" class="diff-input" spellcheck="false" placeholder="Diff preview (editable)"></textarea>
      <div class="meta" id="diffMeta"></div>
    </section>

    <script nonce="${nonce}">
      const DIFF_CHAR_LIMIT = ${DIFF_LIMIT};
      const vscode = acquireVsCodeApi();
      const generateBtn = document.getElementById('generateBtn');
      const generateFromDiffBtn = document.getElementById('generateFromDiffBtn');
      const loadDiffBtn = document.getElementById('loadDiffBtn');
      const sampleDiffBtn = document.getElementById('sampleDiffBtn');
      const copyBtn = document.getElementById('copyBtn');
      const statusEl = document.getElementById('status');
      const resultEl = document.getElementById('result');
      const metaEl = document.getElementById('meta');
      const rawWrapper = document.getElementById('rawWrapper');
      const rawOutput = document.getElementById('rawOutput');
      const progressSpinner = document.getElementById('progressSpinner');
      const diffInput = document.getElementById('diffInput');
      const diffMeta = document.getElementById('diffMeta');
      if (!progressSpinner) {
        throw new Error('Progress spinner element missing.');
      }

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
          beginGeneration('Generating commit message from diff...');
          vscode.postMessage({ type: 'generate-commit-message-from-diff', diff: diffText });
        });
      }

      if (loadDiffBtn) {
        loadDiffBtn.addEventListener('click', () => {
          setStatus('Loading staged diff...', 'busy');
          vscode.postMessage({ type: 'load-staged-diff' });
        });
      }

      if (sampleDiffBtn) {
        sampleDiffBtn.addEventListener('click', () => {
          updateDiffArea({ diff: SAMPLE_DIFF, context: 'custom', note: 'Sample diff inserted. Edit before generating.' });
          setStatus('Sample diff inserted. Edit before generating.', 'ok');
        });
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
  </body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
