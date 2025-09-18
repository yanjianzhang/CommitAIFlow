import * as vscode from 'vscode';

type GitAPI = {
  repositories: Array<{ inputBox: { value: string } }>
};

export function getGitAPI(): GitAPI | undefined {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    const exportsAny = gitExt?.exports as any;
    const api = exportsAny?.getAPI?.(1) as GitAPI | undefined;
    return api;
  } catch {
    return undefined;
  }
}

export async function setScmInputBox(message: string): Promise<boolean> {
  const api = getGitAPI();
  const repo = api?.repositories?.[0];
  if (!repo) return false;
  repo.inputBox.value = message;
  return true;
}

export async function focusSCMView(): Promise<void> {
  await vscode.commands.executeCommand('workbench.view.scm');
}

