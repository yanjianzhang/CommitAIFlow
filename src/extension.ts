import * as vscode from 'vscode';
import { ensureOllamaRunning } from './ollama';
import { showGitGraph } from './gitGraph';

export function activate(context: vscode.ExtensionContext) {
  console.log('CommitAIFlow activated');

  context.subscriptions.push(
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
        await showGitGraph(context);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Git Graph error: ${String(e?.message ?? e)}`);
      }
    }),
    vscode.commands.registerCommand('commitaiflow.planAtomicCommits', async () => {
      vscode.window.showInformationMessage('Plan Atomic Commits: coming soon (MVP placeholder).');
    })
  );
}

export function deactivate() {}