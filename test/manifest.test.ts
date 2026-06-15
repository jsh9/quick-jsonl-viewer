import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

test('package main points to the compiled extension entrypoint', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    readonly main?: unknown;
  };

  const main = packageJson.main;
  assert.equal(typeof main, 'string');

  if (typeof main !== 'string') {
    throw new TypeError('package.json main must be a string');
  }

  await fs.access(path.join(process.cwd(), main));
});

test('package contributes JSONL viewer as the default editor association', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    readonly activationEvents?: unknown;
    readonly contributes?: {
      readonly configurationDefaults?: {
        readonly 'workbench.editorAssociations'?: Record<string, string>;
      };
      readonly languages?: Array<{
        readonly id?: unknown;
        readonly extensions?: unknown;
      }>;
      readonly commands?: Array<{
        readonly command?: unknown;
        readonly title?: unknown;
      }>;
      readonly customEditors?: Array<{
        readonly viewType?: unknown;
        readonly priority?: unknown;
        readonly selector?: Array<{ readonly filenamePattern?: unknown }>;
      }>;
    };
  };

  assert.equal(
    packageJson.contributes?.configurationDefaults?.['workbench.editorAssociations']?.['*.jsonl'],
    'quickJsonlViewer.viewer'
  );

  const openCommand = packageJson.contributes?.commands?.find(
    (command) => command.command === 'quickJsonlViewer.openCurrentFile'
  );
  assert.equal(openCommand?.title, 'Open in Quick JSONL Viewer');

  const customEditor = packageJson.contributes?.customEditors?.find(
    (editor) => editor.viewType === 'quickJsonlViewer.viewer'
  );

  assert.equal(customEditor?.priority, 'default');
  assert.ok(customEditor?.selector?.some((selector) => selector.filenamePattern === '*.jsonl'));
  assert.ok(Array.isArray(packageJson.activationEvents));
  assert.ok(packageJson.activationEvents.includes('onCommand:quickJsonlViewer.openSampleFiles'));
  assert.ok(!packageJson.activationEvents.includes('onLanguage:jsonl'));
  assert.ok(
    packageJson.contributes?.languages?.some(
      (language) =>
        language.id === 'jsonl' &&
        Array.isArray(language.extensions) &&
        language.extensions.includes('.jsonl')
    )
  );
});

test('package wires local test hooks and GitHub Actions test workflow', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    readonly scripts?: Record<string, unknown>;
    readonly devDependencies?: Record<string, unknown>;
  };

  assert.equal(packageJson.scripts?.['test'], 'npm run compile && node scripts/run-tests.cjs');
  assert.equal(packageJson.scripts?.['hooks:install'], undefined);
  assert.equal(packageJson.scripts?.['prepare'], 'husky');
  assert.equal(typeof packageJson.devDependencies?.['husky'], 'string');

  const preCommitHook = await fs.readFile(path.join(process.cwd(), '.husky', 'pre-commit'), 'utf8');
  assert.match(preCommitHook, /npm test/);
  await assert.rejects(fs.access(path.join(process.cwd(), '.githooks', 'pre-commit')));
  await assert.rejects(fs.access(path.join(process.cwd(), 'scripts', 'install-git-hooks.cjs')));

  const workflow = await fs.readFile(path.join(process.cwd(), '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(workflow, /HUSKY: 0/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
});
