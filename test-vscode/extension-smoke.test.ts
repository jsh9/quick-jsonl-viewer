import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

suite('Quick JSONL Viewer VS Code smoke tests', () => {
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('extension activates and contributes expected commands', async () => {
    const extension = vscode.extensions.getExtension('jsh9.quick-jsonl-viewer');
    assert.ok(extension);

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('quickJsonlViewer.openCurrentFile'));
    assert.ok(commands.includes('quickJsonlViewer.openSampleFiles'));
  });

  test('opens a JSONL fixture with the custom viewer command', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'quick-jsonl-viewer-smoke-')
    );
    const filePath = path.join(tempDir, 'fixture.jsonl');
    await fs.writeFile(filePath, '{"a":1}\n{"b":2}', 'utf8');
    const uri = vscode.Uri.file(filePath);

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('quickJsonlViewer.openCurrentFile');

    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return (
        input instanceof vscode.TabInputCustom &&
        input.uri.toString() === uri.toString()
      );
    });

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom);
    assert.equal(input.uri.toString(), uri.toString());
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for VS Code smoke-test condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
