import * as path from 'node:path';
import * as vscode from 'vscode';
import { SAMPLE_JSONL_PATHS, VIEW_TYPE } from './constants';

const DIFF_EDITOR_WARNING =
  'Quick JSONL Viewer is not available in diff editors.';

export async function openJsonlViewer(resource?: vscode.Uri): Promise<void> {
  // Diff tabs expose a modified URI, but opening that URI here would replace
  // the native side-by-side review. Block only implicit command-palette use so
  // explicit Explorer/editor URI invocations can still opt into the viewer.
  if (!resource && isActiveTextDiffEditor()) {
    void vscode.window.showWarningMessage(DIFF_EDITOR_WARNING);
    return;
  }

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

  return undefined;
}

function isActiveTextDiffEditor(): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputTextDiff;
}

function isJsonlFile(uri: vscode.Uri): boolean {
  return (
    uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.jsonl'
  );
}
