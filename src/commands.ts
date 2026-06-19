import * as path from 'node:path';
import * as vscode from 'vscode';
import { SAMPLE_JSONL_PATHS, VIEW_TYPE } from './constants';

export async function openJsonlViewer(resource?: vscode.Uri): Promise<void> {
  const uri = resource ?? getActiveEditorUri();

  if (!uri) {
    void vscode.window.showWarningMessage(
      'Open a JSONL file before running Quick JSONL Viewer.'
    );
    return;
  }

  if (!isJsonlFile(uri)) {
    void vscode.window.showWarningMessage(
      'Quick JSONL Viewer can only open .jsonl files.'
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    VIEW_TYPE,
    vscode.ViewColumn.Active
  );
}

export async function openSampleJsonlFiles(
  extensionUri: vscode.Uri
): Promise<void> {
  for (const [index, relativePath] of SAMPLE_JSONL_PATHS.entries()) {
    const uri = vscode.Uri.joinPath(extensionUri, ...relativePath.split('/'));
    const column =
      index === 0 ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
    await vscode.commands.executeCommand(
      'vscode.openWith',
      uri,
      VIEW_TYPE,
      column
    );
  }
}

function getActiveEditorUri(): vscode.Uri | undefined {
  const activeTextEditorUri = vscode.window.activeTextEditor?.document.uri;

  if (activeTextEditorUri) {
    return activeTextEditorUri;
  }

  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom
  ) {
    return input.uri;
  }

  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }

  return undefined;
}

function isJsonlFile(uri: vscode.Uri): boolean {
  return (
    uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.jsonl'
  );
}
