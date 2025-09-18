import * as vscode from 'vscode';

interface ActionDescriptor {
  readonly label: string;
  readonly tooltip?: string;
  readonly command: string;
  readonly icon?: vscode.ThemeIcon;
  readonly args?: unknown[];
}

export class ActionTreeDataProvider implements vscode.TreeDataProvider<ActionDescriptor> {
  private readonly items: ActionDescriptor[] = [
    {
      label: 'Generate Commit Message',
      tooltip: 'AI-generate a Conventional Commit message and write it into the SCM input box',
      command: 'commitaiflow.generateCommitMessageToScm',
      icon: new vscode.ThemeIcon('comment-discussion')
    },
    {
      label: 'Preview Staged Diff',
      tooltip: 'Open the current staged diff in a read-only editor for review',
      command: 'commitaiflow.previewStagedDiff',
      icon: new vscode.ThemeIcon('diff')
    },
    {
      label: 'Stage Sandbox Change',
      tooltip: 'Generate and stage a synthetic change in the sandbox repo for testing',
      command: 'commitaiflow.refreshSandboxChange',
      icon: new vscode.ThemeIcon('repo-push')
    },
    {
      label: 'Open Sandbox Folder',
      tooltip: 'Open the sandbox Git repository in a new VS Code window',
      command: 'commitaiflow.openSandboxFolder',
      icon: new vscode.ThemeIcon('folder-opened')
    }
  ];

  getTreeItem(element: ActionDescriptor): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.command = {
      command: element.command,
      title: element.label,
      arguments: element.args
    };
    if (element.tooltip) {
      item.tooltip = element.tooltip;
    }
    if (element.icon) {
      item.iconPath = element.icon;
    }
    item.contextValue = element.command;
    return item;
  }

  getChildren(): vscode.ProviderResult<ActionDescriptor[]> {
    return this.items;
  }
}
