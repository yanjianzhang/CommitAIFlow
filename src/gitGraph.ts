import * as vscode from 'vscode';

export async function showGitGraph(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'gitGraph', 'Git Commit Flow (Preview)', vscode.ViewColumn.Active, { enableScripts: true }
  );
  panel.webview.html = `
    <!doctype html><html><body style="font-family: system-ui; padding: 12px">
      <h3>Git Graph placeholder</h3>
      <p>We’ll render the DAG here in the next step.</p>
    </body></html>`;
}