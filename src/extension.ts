import * as vscode from 'vscode';
import { ensureOllamaRunning } from './ollama';
import { showGitGraph, GitGraphViewProvider, GIT_GRAPH_VIEW_ID, GIT_GRAPH_CONTAINER_ID } from './gitGraph';

export function activate(context: vscode.ExtensionContext) {
  console.log('CommitAIFlow activated');

  const gitGraphProvider = new GitGraphViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GitGraphViewProvider.viewType, gitGraphProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('commitaiflow.startOllama', async () => {
      try {
        await ensureOllamaRunning(true);
        vscode.window.showInformationMessage('Ollama is running on http://localhost:11434');
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to start Ollama: ${String(e?.message ?? e)}`);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.showGitGraph', async () => {
      try {
        await vscode.commands.executeCommand(`workbench.view.extension.${GIT_GRAPH_CONTAINER_ID}`);
        await vscode.commands.executeCommand(`views.${GIT_GRAPH_VIEW_ID}.focus`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Git Graph error: ${String(e?.message ?? e)}`);
        await showGitGraph(context);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.planAtomicCommits', async () => {
      vscode.window.showInformationMessage('Plan Atomic Commits: coming soon (MVP placeholder).');
    })
  );
}

export function deactivate() {}
