import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

test('package main points to the compiled extension entrypoint', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
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
  // Verifies default JSONL opens still use the custom viewer, while native
  // diff associations and menu guards keep Git review flows in VS Code's diff.
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
    readonly engines?: { readonly vscode?: unknown };
    readonly activationEvents?: unknown;
    readonly contributes?: {
      readonly configurationDefaults?: {
        readonly 'workbench.editorAssociations'?: Record<string, string>;
        readonly 'workbench.diffEditorAssociations'?: Record<string, string>;
      };
      readonly languages?: Array<{
        readonly id?: unknown;
        readonly extensions?: unknown;
      }>;
      readonly commands?: Array<{
        readonly command?: unknown;
        readonly title?: unknown;
      }>;
      readonly menus?: Record<
        string,
        Array<{
          readonly command?: unknown;
          readonly when?: unknown;
          readonly group?: unknown;
        }>
      >;
      readonly customEditors?: Array<{
        readonly viewType?: unknown;
        readonly priority?: unknown;
        readonly selector?: Array<{ readonly filenamePattern?: unknown }>;
      }>;
      readonly configuration?: {
        readonly properties?: Record<
          string,
          {
            readonly type?: unknown;
            readonly default?: unknown;
            readonly minimum?: unknown;
            readonly description?: unknown;
          }
        >;
      };
    };
  };

  assert.equal(
    packageJson.contributes?.configurationDefaults?.[
      'workbench.editorAssociations'
    ]?.['*.jsonl'],
    'quickJsonlViewer.viewer'
  );
  assert.equal(
    packageJson.contributes?.configurationDefaults?.[
      'workbench.diffEditorAssociations'
    ]?.['*.jsonl'],
    'default'
  );
  assert.equal(packageJson.engines?.vscode, '^1.120.0');

  const openCommand = packageJson.contributes?.commands?.find(
    (command) => command.command === 'quickJsonlViewer.openCurrentFile'
  );
  assert.equal(openCommand?.title, 'Open in Quick JSONL Viewer');

  const commandPaletteEntry = packageJson.contributes?.menus?.[
    'commandPalette'
  ]?.find((entry) => entry.command === 'quickJsonlViewer.openCurrentFile');
  assert.equal(commandPaletteEntry?.when, '!isInDiffEditor');

  const editorTitleEntry = packageJson.contributes?.menus?.[
    'editor/title'
  ]?.find((entry) => entry.command === 'quickJsonlViewer.openCurrentFile');
  assert.equal(
    editorTitleEntry?.when,
    'resourceScheme == file && resourceExtname == .jsonl && !isInDiffEditor'
  );

  const explorerContextEntry = packageJson.contributes?.menus?.[
    'explorer/context'
  ]?.find((entry) => entry.command === 'quickJsonlViewer.openCurrentFile');
  assert.equal(
    explorerContextEntry?.when,
    'resourceScheme == file && resourceExtname == .jsonl'
  );

  const customEditor = packageJson.contributes?.customEditors?.find(
    (editor) => editor.viewType === 'quickJsonlViewer.viewer'
  );

  assert.equal(customEditor?.priority, 'default');
  assert.ok(
    customEditor?.selector?.some(
      (selector) => selector.filenamePattern === '*.jsonl'
    )
  );
  assert.ok(Array.isArray(packageJson.activationEvents));
  assert.ok(
    packageJson.activationEvents.includes(
      'onCommand:quickJsonlViewer.openSampleFiles'
    )
  );
  assert.ok(!packageJson.activationEvents.includes('onLanguage:jsonl'));
  assert.ok(
    packageJson.contributes?.languages?.some(
      (language) =>
        language.id === 'jsonl' &&
        Array.isArray(language.extensions) &&
        language.extensions.includes('.jsonl')
    )
  );
  assert.deepEqual(
    packageJson.contributes?.configuration?.properties?.[
      'quickJsonlViewer.autoRefresh'
    ],
    {
      type: 'boolean',
      default: true,
      description:
        'Automatically refresh open JSONL viewers when the underlying file changes. Disable to refresh manually from the viewer toolbar.'
    }
  );
  assert.deepEqual(
    packageJson.contributes?.configuration?.properties?.[
      'quickJsonlViewer.indentGuides'
    ],
    {
      type: 'boolean',
      default: true,
      description: 'Show vertical indentation guides in Pretty print mode.'
    }
  );
  assert.deepEqual(
    packageJson.contributes?.configuration?.properties?.[
      'quickJsonlViewer.maxRenderedRowBytes'
    ],
    {
      type: 'integer',
      default: 1048576,
      minimum: 1,
      description:
        'Maximum JSONL row size, in bytes, that Quick JSONL Viewer will parse, format, and render. Larger rows are shown as oversized previews.'
    }
  );
  assert.deepEqual(
    packageJson.contributes?.configuration?.properties?.[
      'quickJsonlViewer.oversizedRowPreviewBytes'
    ],
    {
      type: 'integer',
      default: 4096,
      minimum: 0,
      description:
        'Number of leading bytes to show for JSONL rows that exceed the max rendered row size. Set to 0 to hide oversized row previews.'
    }
  );
  // Guards the public settings surface: Start at line is per-view state, so
  // existing user/workspace quickJsonlViewer.startLine values are ignored.
  assert.equal(
    packageJson.contributes?.configuration?.properties?.[
      'quickJsonlViewer.startLine'
    ],
    undefined
  );
});

test('package wires local test hooks, formatting, and GitHub Actions test workflow', async () => {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(
    await fs.readFile(packageJsonPath, 'utf8')
  ) as {
    readonly scripts?: Record<string, unknown>;
    readonly devDependencies?: Record<string, unknown>;
  };

  assert.equal(
    packageJson.scripts?.['test'],
    'npm run format:check && npm run compile && npm run test:coverage'
  );
  assert.equal(
    packageJson.scripts?.['test:unit'],
    'node scripts/run-tests.cjs'
  );
  assert.equal(
    packageJson.scripts?.['test:coverage'],
    "c8 --all --src out/src --include 'out/src/**/*.js' --check-coverage --lines 95 --branches 95 --functions 95 npm run test:unit"
  );
  assert.equal(
    packageJson.scripts?.['test:vscode'],
    'npm run compile && vscode-test'
  );
  assert.equal(
    packageJson.scripts?.['format'],
    'prettier . --write --ignore-unknown'
  );
  assert.equal(
    packageJson.scripts?.['format:check'],
    'prettier . --check --ignore-unknown'
  );
  assert.equal(packageJson.scripts?.['hooks:install'], undefined);
  assert.equal(packageJson.scripts?.['prepare'], 'husky');
  assert.equal(
    typeof packageJson.devDependencies?.['@vscode/test-cli'],
    'string'
  );
  assert.equal(
    typeof packageJson.devDependencies?.['@vscode/test-electron'],
    'string'
  );
  assert.equal(typeof packageJson.devDependencies?.['@types/mocha'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['c8'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['husky'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['mocha'], 'string');
  assert.equal(typeof packageJson.devDependencies?.['prettier'], 'string');

  const preCommitHook = await fs.readFile(
    path.join(process.cwd(), '.husky', 'pre-commit'),
    'utf8'
  );
  assert.match(preCommitHook, /npm test/);
  await assert.rejects(
    fs.access(path.join(process.cwd(), '.githooks', 'pre-commit'))
  );
  await assert.rejects(
    fs.access(path.join(process.cwd(), 'scripts', 'install-git-hooks.cjs'))
  );

  const workflow = await fs.readFile(
    path.join(process.cwd(), '.github', 'workflows', 'test.yml'),
    'utf8'
  );
  assert.match(workflow, /HUSKY: 0/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /xvfb-run -a npm run test:vscode/);
});
