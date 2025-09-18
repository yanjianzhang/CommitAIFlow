import * as vscode from 'vscode';
import { ensureOllamaRunning } from './ollama';
import { generateCommitMessage } from './commitMessage';
import { focusSCMView, setScmInputBox } from './scm';
import { ensureSandboxRepo, makeSyntheticChange } from './devSandbox';
import { ActionTreeDataProvider } from './actionTree';

export function activate(context: vscode.ExtensionContext) {
  console.log('CommitAIFlow activated');

  // In development, prepare a sandbox Git repo and stage a change on each activation
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const baseDir = context.extensionUri.fsPath;
    ensureSandboxRepo(baseDir)
      .then(async repoPath => {
        const res = await makeSyntheticChange(repoPath);
        console.log('[CommitAIFlow] Sandbox changed file:', res.changedFile);
        vscode.commands.executeCommand('setContext', 'commitaiflow.sandboxPath', repoPath);
      })
      .catch(err => console.warn('[CommitAIFlow] Sandbox setup failed:', err));
  }

  context.subscriptions.push(
    // Virtual diff content provider (built-in text editor)
    vscode.workspace.registerTextDocumentContentProvider('commitaiflow-diff', {
      provideTextDocumentContent: async (_uri) => {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return 'No workspace folder.';
        try {
          const { getStagedDiff } = await import('./git');
          const { DIFF_LIMIT } = await import('./commitMessage');
          const res = await getStagedDiff(ws.uri.fsPath, DIFF_LIMIT);
          const header = res.truncated ? `# Staged diff (truncated to ${DIFF_LIMIT} chars)\n\n` : '# Staged diff\n\n';
          return header + (res.diff || '(empty)');
        } catch (e: any) {
          return 'Failed to load staged diff: ' + String(e?.message ?? e);
        }
      }
    }),
    vscode.window.registerTreeDataProvider('commitaiflow-actions', new ActionTreeDataProvider()),
    vscode.commands.registerCommand('commitaiflow.startOllama', async () => {
      try {
        await ensureOllamaRunning(true);
        vscode.window.showInformationMessage('Ollama is running on http://localhost:11434');
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to start Ollama: ${String(e?.message ?? e)}`);
      }
    }),
    // Generate message using built-in SCM input box (no webview)
    vscode.commands.registerCommand('commitaiflow.generateCommitMessageToScm', async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        vscode.window.showErrorMessage('Open a workspace folder with a Git repository.');
        return;
      }
      try {
        const result = await vscode.window.withProgress(
          {
            cancellable: false,
            location: vscode.ProgressLocation.Notification,
            title: 'Generating commit message with Ollama...'
          },
          () => generateCommitMessage(workspace.uri.fsPath)
        );
        const ok = await setScmInputBox(result.message);
        await focusSCMView();
        if (!ok) {
          vscode.window.showInformationMessage('Generated message (copied to clipboard).');
          await vscode.env.clipboard.writeText(result.message);
        } else {
          vscode.window.showInformationMessage('Commit message inserted into SCM input.');
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Generate failed: ${String(e?.message ?? e)}`);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.showGitGraph', async () => {
      try {
        await vscode.commands.executeCommand('workbench.view.extension.commitaiflow-gitflow');
        await vscode.commands.executeCommand('views.commitaiflow-actions.focus');
      } catch (e: any) {
        vscode.window.showErrorMessage(`Open CommitAIFlow view failed: ${String(e?.message ?? e)}`);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.planAtomicCommits', async () => {
      vscode.window.showInformationMessage('Plan Atomic Commits: coming soon (MVP placeholder).');
    }),
    vscode.commands.registerCommand('commitaiflow.openSandboxFolder', async () => {
      try {
        const repoPath = await ensureSandboxRepo(context.extensionUri.fsPath);
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoPath), { forceNewWindow: true });
      } catch (e: any) {
        vscode.window.showErrorMessage(`Open Sandbox failed: ${String(e?.message ?? e)}`);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.refreshSandboxChange', async () => {
      try {
        const repoPath = await ensureSandboxRepo(context.extensionUri.fsPath);
        const res = await makeSyntheticChange(repoPath);
        vscode.window.showInformationMessage('Sandbox change staged: ' + res.changedFile);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Sandbox change failed: ${String(e?.message ?? e)}`);
      }
    }),
    // Open the staged diff in a built-in text editor as a virtual document
    vscode.commands.registerCommand('commitaiflow.previewStagedDiff', async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) { vscode.window.showErrorMessage('Open a workspace folder first.'); return; }
      try {
        const uri = vscode.Uri.parse('commitaiflow-diff:Staged%20Diff');
        await vscode.commands.executeCommand('vscode.openWith', uri, 'default', vscode.ViewColumn.Active);
      } catch (e: any) {
        vscode.window.showErrorMessage('Open staged diff failed: ' + String(e?.message ?? e));
      }
    })
  );
}

export function deactivate() {}
