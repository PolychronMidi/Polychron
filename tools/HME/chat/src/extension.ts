import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel';

export function activate(context: vscode.ExtensionContext) {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  context.subscriptions.push(
    vscode.commands.registerCommand('hme-chat.open', () => {
      ChatPanel.createOrShow(projectRoot);
    })
  );

  // Restore panel automatically on developer reload (like other editor tabs)
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('hmeChat', {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
        ChatPanel.deserialize(panel, state, projectRoot);
      },
    })
  );
}

export function deactivate() {}
