import * as assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

interface GitExtension {
  getAPI(version: 1): GitApi;
}

interface GitApi {
  openRepository(root: vscode.Uri): Promise<GitRepository | null>;
}

interface GitRepository {
  readonly state: GitRepositoryState;
  status(): Promise<void>;
}

interface GitRepositoryState {
  readonly indexChanges: readonly GitChange[];
  readonly workingTreeChanges: readonly GitChange[];
}

interface GitChange {
  readonly uri: vscode.Uri;
}

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

  test('opens unstaged Git JSONL diffs with VS Code text diff editor', async function () {
    // Verifies Git's unstaged change command keeps JSONL review in the native
    // diff editor, covering the integration path manifest-only tests miss.
    this.timeout(10_000);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    const { repoDir, fileUri } = await createGitJsonlFixture();
    const repository = await openGitRepository(repoDir);
    await fs.writeFile(fileUri.fsPath, '{"a":2}\n', 'utf8');

    await waitFor(async () => {
      await repository.status();
      return hasChange(repository.state.workingTreeChanges, fileUri);
    });

    await vscode.commands.executeCommand('git.openChange', fileUri);

    await waitFor(() => isGitTextDiffFor(fileUri));
    assertGitTextDiffFor(fileUri);
  });

  test('opens staged Git JSONL diffs with VS Code text diff editor', async function () {
    // Verifies staged JSONL review also stays native; Git uses git: URIs here,
    // so this protects the common review path separately from unstaged changes.
    this.timeout(10_000);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    const { repoDir, fileUri } = await createGitJsonlFixture();
    const repository = await openGitRepository(repoDir);
    await fs.writeFile(fileUri.fsPath, '{"a":2}\n', 'utf8');
    await runGit(repoDir, ['add', 'fixture.jsonl']);

    await waitFor(async () => {
      await repository.status();
      return (
        hasChange(repository.state.indexChanges, fileUri) &&
        !hasChange(repository.state.workingTreeChanges, fileUri)
      );
    });

    await vscode.commands.executeCommand('git.openChange', fileUri);

    await waitFor(() => isGitTextDiffFor(fileUri));
    assertGitTextDiffFor(fileUri);
  });
});

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  await execFileAsync('git', [...args], { cwd });
}

async function createGitJsonlFixture(): Promise<{
  readonly repoDir: string;
  readonly fileUri: vscode.Uri;
}> {
  const repoDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'quick-jsonl-viewer-git-diff-smoke-')
  );
  const filePath = path.join(repoDir, 'fixture.jsonl');

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'quick-jsonl-viewer@test']);
  await runGit(repoDir, ['config', 'user.name', 'Quick JSONL Viewer Test']);
  await fs.writeFile(filePath, '{"a":1}\n', 'utf8');
  await runGit(repoDir, ['add', 'fixture.jsonl']);
  await runGit(repoDir, ['commit', '-m', 'Initial JSONL fixture']);

  return {
    repoDir,
    fileUri: vscode.Uri.file(filePath)
  };
}

async function openGitRepository(repoDir: string): Promise<GitRepository> {
  const gitExtension =
    vscode.extensions.getExtension<GitExtension>('vscode.git');
  assert.ok(gitExtension);
  const git = await gitExtension.activate();
  const api = git.getAPI(1);
  let repository: GitRepository | null = null;

  await waitFor(async () => {
    repository = await api.openRepository(vscode.Uri.file(repoDir));
    if (!repository) {
      return false;
    }

    await repository.status();
    return true;
  });

  assert.ok(repository);
  return repository;
}

function hasChange(changes: readonly GitChange[], uri: vscode.Uri): boolean {
  return changes.some((change) => change.uri.toString() === uri.toString());
}

function isGitTextDiffFor(uri: vscode.Uri): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return (
    input instanceof vscode.TabInputTextDiff &&
    diffIncludesUri(input, uri) &&
    diffIncludesGitUri(input)
  );
}

function assertGitTextDiffFor(uri: vscode.Uri): void {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputTextDiff);
  assert.ok(!(input instanceof vscode.TabInputCustom));
  assert.ok(diffIncludesUri(input, uri));
  assert.ok(diffIncludesGitUri(input));
}

function diffIncludesUri(
  input: vscode.TabInputTextDiff,
  uri: vscode.Uri
): boolean {
  return [input.original, input.modified].some(
    (diffUri) =>
      diffUri.toString().includes(path.basename(uri.fsPath)) ||
      diffUri.fsPath === uri.fsPath
  );
}

function diffIncludesGitUri(input: vscode.TabInputTextDiff): boolean {
  return [input.original, input.modified].some(
    (diffUri) => diffUri.scheme === 'git'
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for VS Code smoke-test condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
