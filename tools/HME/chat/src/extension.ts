import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';

export function activate(context: vscode.ExtensionContext) {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  context.subscriptions.push(
    vscode.commands.registerCommand('hme-chat.open', () => {
      ChatPanel.createOrShow(projectRoot);
    })
  );
}

export function deactivate() {}
