import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';

interface Disposable {
  dispose(): void;
}

interface RecordedCommand {
  readonly command: string;
  readonly args: unknown[];
}

interface RegisteredProvider {
  readonly viewType: string;
  readonly provider: {
    openCustomDocument(uri: FakeUri): Promise<{ readonly uri: FakeUri }>;
    resolveCustomEditor(
      document: { readonly uri: FakeUri },
      webviewPanel: FakeWebviewPanel,
      token: unknown
    ): Promise<void>;
  };
  readonly options: unknown;
}

class FakeUri {
  public constructor(
    public readonly fsPath: string,
    public readonly scheme = 'file'
  ) {}

  public toString(): string {
    return `${this.scheme}:${this.fsPath}`;
  }

  public static file(fsPath: string): FakeUri {
    return new FakeUri(fsPath);
  }

  public static joinPath(base: FakeUri, ...segments: string[]): FakeUri {
    return new FakeUri(path.join(base.fsPath, ...segments), base.scheme);
  }
}

class FakeTabInputText {
  public constructor(public readonly uri: FakeUri) {}
}

class FakeTabInputCustom {
  public constructor(public readonly uri: FakeUri) {}
}

class FakeTabInputTextDiff {
  public constructor(
    public readonly original: FakeUri,
    public readonly modified: FakeUri
  ) {}
}

class FakeWebview {
  public options: unknown;
  public html = '';
  public readonly messages: unknown[] = [];
  private readonly messageListeners: Array<(message: unknown) => void> = [];

  public onDidReceiveMessage(listener: (message: unknown) => void): Disposable {
    this.messageListeners.push(listener);
    return {
      dispose: () => {
        const index = this.messageListeners.indexOf(listener);
        if (index >= 0) {
          this.messageListeners.splice(index, 1);
        }
      }
    };
  }

  public async postMessage(message: unknown): Promise<boolean> {
    this.messages.push(message);
    return true;
  }

  public receive(message: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(message);
    }
  }
}

class FakeWebviewPanel {
  public readonly webview = new FakeWebview();
  public viewColumn: number | undefined = FakeVscode.ViewColumn.One;
  public readonly revealCalls: Array<readonly [number, boolean]> = [];
  private readonly disposeListeners: Array<() => void> = [];

  public reveal(viewColumn: number, preserveFocus: boolean): void {
    this.revealCalls.push([viewColumn, preserveFocus]);
  }

  public onDidDispose(listener: () => void): Disposable {
    this.disposeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.disposeListeners.indexOf(listener);
        if (index >= 0) {
          this.disposeListeners.splice(index, 1);
        }
      }
    };
  }

  public dispose(): void {
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }
}

class FakeVscode {
  public static readonly ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1
  } as const;

  public static readonly ConfigurationTarget = {
    Global: 1
  } as const;

  public readonly warnings: string[] = [];
  public readonly errors: string[] = [];
  public readonly registeredCommands = new Map<
    string,
    (...args: unknown[]) => unknown
  >();
  public readonly executedCommands: RecordedCommand[] = [];
  public readonly providerRegistrations: RegisteredProvider[] = [];
  public readonly configurationUpdates: Array<{
    readonly key: string;
    readonly value: unknown;
    readonly target: unknown;
  }> = [];
  public readonly configurationListeners: Array<{
    readonly listener: (event: {
      affectsConfiguration(section: string): boolean;
    }) => void;
    disposed: boolean;
  }> = [];
  public readonly saveListeners: Array<{
    readonly listener: (document: { readonly uri: FakeUri }) => void;
    disposed: boolean;
  }> = [];
  public activeTextEditorUri: FakeUri | undefined;
  public activeTabInput: unknown;
  public maxLines = 20;
  public indent = 2;
  public executeCommandError: unknown;
  public configurationUpdateError: unknown;

  public readonly vscode = {
    commands: {
      registerCommand: (
        command: string,
        callback: (...args: unknown[]) => unknown
      ): Disposable => {
        this.registeredCommands.set(command, callback);
        return disposable();
      },
      executeCommand: async (
        command: string,
        ...args: unknown[]
      ): Promise<unknown> => {
        this.executedCommands.push({ command, args });
        if (this.executeCommandError) {
          throw this.executeCommandError;
        }

        return undefined;
      }
    },
    workspace: {
      getConfiguration: (section: string) => {
        assert.equal(section, 'quickJsonlViewer');
        return {
          get: (key: string): unknown => {
            if (key === 'maxLines') {
              return this.maxLines;
            }

            if (key === 'indent') {
              return this.indent;
            }

            return undefined;
          },
          update: async (
            key: string,
            value: unknown,
            target: unknown
          ): Promise<void> => {
            if (this.configurationUpdateError) {
              throw this.configurationUpdateError;
            }

            this.configurationUpdates.push({ key, value, target });
            if (key === 'maxLines' && typeof value === 'number') {
              this.maxLines = value;
            }
          }
        };
      },
      onDidChangeConfiguration: (
        listener: (event: {
          affectsConfiguration(section: string): boolean;
        }) => void
      ): Disposable => {
        const registration = { listener, disposed: false };
        this.configurationListeners.push(registration);
        return {
          dispose: () => {
            registration.disposed = true;
          }
        };
      },
      onDidSaveTextDocument: (
        listener: (document: { readonly uri: FakeUri }) => void
      ): Disposable => {
        const registration = { listener, disposed: false };
        this.saveListeners.push(registration);
        return {
          dispose: () => {
            registration.disposed = true;
          }
        };
      }
    },
    window: {
      get activeTextEditor() {
        return thisOwner.activeTextEditorUri
          ? { document: { uri: thisOwner.activeTextEditorUri } }
          : undefined;
      },
      tabGroups: {
        activeTabGroup: {
          get activeTab() {
            return thisOwner.activeTabInput
              ? { input: thisOwner.activeTabInput }
              : undefined;
          }
        }
      },
      showWarningMessage: async (message: string): Promise<void> => {
        this.warnings.push(message);
      },
      showErrorMessage: async (message: string): Promise<void> => {
        this.errors.push(message);
      },
      registerCustomEditorProvider: (
        viewType: string,
        provider: RegisteredProvider['provider'],
        options: unknown
      ): Disposable => {
        this.providerRegistrations.push({ viewType, provider, options });
        return disposable();
      }
    },
    Uri: FakeUri,
    ViewColumn: FakeVscode.ViewColumn,
    ConfigurationTarget: FakeVscode.ConfigurationTarget,
    TabInputText: FakeTabInputText,
    TabInputCustom: FakeTabInputCustom,
    TabInputTextDiff: FakeTabInputTextDiff
  };

  public fireConfigurationChange(sections: readonly string[]): void {
    const event = {
      affectsConfiguration: (section: string): boolean =>
        sections.includes(section)
    };
    for (const registration of this.configurationListeners) {
      if (!registration.disposed) {
        registration.listener(event);
      }
    }
  }

  public fireSave(uri: FakeUri): void {
    for (const registration of this.saveListeners) {
      if (!registration.disposed) {
        registration.listener({ uri });
      }
    }
  }
}

const thisOwner = {
  activeTextEditorUri: undefined as FakeUri | undefined,
  activeTabInput: undefined as unknown
};

let tempDir = '';

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-jsonl-viewer-ext-'));
});

after(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('activate registers commands and the custom editor provider', () => {
  const harness = loadExtension();
  try {
    const context = createContext();

    harness.extension.activate(context);

    assert.equal(context.subscriptions.length, 3);
    assert.ok(
      harness.fake.registeredCommands.has('quickJsonlViewer.openCurrentFile')
    );
    assert.ok(
      harness.fake.registeredCommands.has('quickJsonlViewer.openSampleFiles')
    );
    assert.equal(harness.fake.providerRegistrations.length, 1);
    assert.equal(
      harness.fake.providerRegistrations[0]?.viewType,
      'quickJsonlViewer.viewer'
    );
    assert.deepEqual(harness.fake.providerRegistrations[0]?.options, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        enableFindWidget: true,
        retainContextWhenHidden: true
      }
    });
  } finally {
    harness.restore();
  }
});

test('openCurrentFile validates input and opens JSONL resources', async () => {
  const harness = loadExtension();
  try {
    harness.extension.activate(createContext());
    const openCurrentFile = getCommand(
      harness.fake,
      'quickJsonlViewer.openCurrentFile'
    );
    const jsonlUri = FakeUri.file(path.join(tempDir, 'direct.jsonl'));

    await openCurrentFile();
    assert.equal(
      harness.fake.warnings.at(-1),
      'Open a JSONL file before running Quick JSONL Viewer.'
    );

    await openCurrentFile(FakeUri.file(path.join(tempDir, 'not-json.txt')));
    assert.equal(
      harness.fake.warnings.at(-1),
      'Quick JSONL Viewer can only open .jsonl files.'
    );

    await openCurrentFile(
      new FakeUri(path.join(tempDir, 'remote.jsonl'), 'untitled')
    );
    assert.equal(
      harness.fake.warnings.at(-1),
      'Quick JSONL Viewer can only open .jsonl files.'
    );

    await openCurrentFile(jsonlUri);
    assert.deepEqual(harness.fake.executedCommands.at(-1), {
      command: 'vscode.openWith',
      args: [jsonlUri, 'quickJsonlViewer.viewer', FakeVscode.ViewColumn.Active]
    });
  } finally {
    harness.restore();
  }
});

test('openCurrentFile resolves active editor, custom tab, and diff tab URIs', async () => {
  const harness = loadExtension();
  try {
    harness.extension.activate(createContext());
    const openCurrentFile = getCommand(
      harness.fake,
      'quickJsonlViewer.openCurrentFile'
    );
    const textUri = FakeUri.file(path.join(tempDir, 'active.jsonl'));
    const customUri = FakeUri.file(path.join(tempDir, 'custom.jsonl'));
    const modifiedUri = FakeUri.file(path.join(tempDir, 'modified.jsonl'));

    harness.fake.activeTextEditorUri = textUri;
    thisOwner.activeTextEditorUri = textUri;
    await openCurrentFile();
    assert.equal(harness.fake.executedCommands.at(-1)?.args[0], textUri);

    harness.fake.activeTextEditorUri = undefined;
    thisOwner.activeTextEditorUri = undefined;
    harness.fake.activeTabInput = new FakeTabInputText(textUri);
    thisOwner.activeTabInput = harness.fake.activeTabInput;
    await openCurrentFile();
    assert.equal(harness.fake.executedCommands.at(-1)?.args[0], textUri);

    harness.fake.activeTabInput = new FakeTabInputCustom(customUri);
    thisOwner.activeTabInput = harness.fake.activeTabInput;
    await openCurrentFile();
    assert.equal(harness.fake.executedCommands.at(-1)?.args[0], customUri);

    harness.fake.activeTabInput = new FakeTabInputTextDiff(
      FakeUri.file(path.join(tempDir, 'original.jsonl')),
      modifiedUri
    );
    thisOwner.activeTabInput = harness.fake.activeTabInput;
    await openCurrentFile();
    assert.equal(harness.fake.executedCommands.at(-1)?.args[0], modifiedUri);
  } finally {
    thisOwner.activeTextEditorUri = undefined;
    thisOwner.activeTabInput = undefined;
    harness.restore();
  }
});

test('command handlers report async open failures', async () => {
  const harness = loadExtension();
  try {
    harness.extension.activate(createContext());
    harness.fake.executeCommandError = new Error('open failed');

    await getCommand(
      harness.fake,
      'quickJsonlViewer.openCurrentFile'
    )(FakeUri.file(path.join(tempDir, 'failure.jsonl')));
    await waitFor(() => harness.fake.errors.length === 1);
    assert.equal(
      harness.fake.errors[0],
      'Quick JSONL Viewer failed to open the file: open failed'
    );

    await getCommand(harness.fake, 'quickJsonlViewer.openSampleFiles')();
    await waitFor(() => harness.fake.errors.length === 2);
    assert.equal(
      harness.fake.errors[1],
      'Quick JSONL Viewer failed to open sample files: open failed'
    );
  } finally {
    harness.restore();
  }
});

test('openSampleFiles opens bundled samples in the intended columns', async () => {
  const harness = loadExtension();
  try {
    const extensionUri = FakeUri.file(path.join(tempDir, 'extension-root'));
    harness.extension.activate(createContext(extensionUri));

    await getCommand(harness.fake, 'quickJsonlViewer.openSampleFiles')();

    assert.equal(harness.fake.executedCommands.length, 2);
    assert.deepEqual(
      harness.fake.executedCommands.map((event) => event.command),
      ['vscode.openWith', 'vscode.openWith']
    );
    assert.equal(
      (harness.fake.executedCommands[0]?.args[0] as FakeUri).fsPath,
      path.join(extensionUri.fsPath, 'sample-data', 'sample-data.jsonl')
    );
    assert.equal(
      harness.fake.executedCommands[0]?.args[2],
      FakeVscode.ViewColumn.One
    );
    assert.equal(
      (harness.fake.executedCommands[1]?.args[0] as FakeUri).fsPath,
      path.join(extensionUri.fsPath, 'sample-data', 'large-placeholder.jsonl')
    );
    assert.equal(
      harness.fake.executedCommands[1]?.args[2],
      FakeVscode.ViewColumn.Beside
    );
  } finally {
    harness.restore();
  }
});

test('custom editor posts limited preview data after the webview is ready', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'preview & value.jsonl',
    '{"a":1}\nnot-json\n{"b":2}'
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 2;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    assert.deepEqual(panel.webview.options, { enableScripts: true });
    assert.match(panel.webview.html, /preview &amp; value\.jsonl/);
    assert.deepEqual(panel.revealCalls, [[FakeVscode.ViewColumn.One, false]]);
    assert.equal(panel.webview.messages.length, 0);

    panel.webview.receive({ type: 'ready' });
    const data = await waitForMessage<{
      readonly type: string;
      readonly payload: { readonly preview: { readonly entries: unknown[] } };
    }>(panel, (message) => message.type === 'data');

    assert.equal(data.payload.preview.entries.length, 2);
    assert.deepEqual(
      panel.webview.messages
        .map((message) => getMessageType(message))
        .slice(0, 3),
      ['loading', 'previewLoadStart', 'previewLoadProgress']
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor handles full indexing, row fetches, cancellation, and raw contents', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'full.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}'
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 0;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'rows-1',
      start: 1,
      count: 2,
      mode: 'rawLine'
    });
    const rows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly mode: string;
      readonly payload: {
        readonly start: number;
        readonly entries: Array<{ readonly raw: string }>;
      };
    }>(panel, (message) => message.type === 'rows');
    assert.equal(rows.requestId, 'rows-1');
    assert.equal(rows.mode, 'rawLine');
    assert.equal(rows.payload.start, 1);
    assert.deepEqual(
      rows.payload.entries.map((entry) => entry.raw),
      ['{"b":2}', '{"c":3}']
    );

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'rows-2',
      start: 'bad',
      count: Number.POSITIVE_INFINITY,
      mode: 'unknown'
    });
    const defaultedRows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly mode: string;
      readonly payload: { readonly start: number; readonly entries: unknown[] };
    }>(
      panel,
      (message) => message.type === 'rows' && message.requestId === 'rows-2'
    );
    assert.equal(defaultedRows.mode, 'pretty');
    assert.equal(defaultedRows.payload.start, 0);
    assert.equal(defaultedRows.payload.entries.length, 0);

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'rows-3',
      start: 0,
      count: 1,
      mode: 'wrappedRaw'
    });
    const wrappedRows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly mode: string;
    }>(
      panel,
      (message) => message.type === 'rows' && message.requestId === 'rows-3'
    );
    assert.equal(wrappedRows.mode, 'wrappedRaw');

    panel.webview.receive({ type: 'cancelIndex' });
    await waitForMessage(
      panel,
      (message) => message.type === 'fullIndexCancelled'
    );

    panel.viewColumn = undefined as unknown as number;
    panel.webview.receive({ type: 'rawContents' });
    assert.deepEqual(harness.fake.executedCommands.at(-1), {
      command: 'vscode.openWith',
      args: [uri, 'default', FakeVscode.ViewColumn.Active]
    });
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor validates max-line messages and writes valid updates', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('settings.jsonl', '{"a":1}');
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(FakeUri.file(filePath));
    await provider.resolveCustomEditor(document, panel, {});

    panel.webview.receive({ type: 'updateMaxLines', value: -1 });
    await waitForMessage(panel, (message) => message.type === 'maxLinesError');

    const errorCount = panel.webview.messages.length;
    panel.webview.receive({ type: 'updateMaxLines', value: '7' });
    await waitFor(() =>
      panel.webview.messages
        .slice(errorCount)
        .some((message) => getMessageType(message) === 'maxLinesError')
    );

    panel.webview.receive({ type: 'updateMaxLines', value: 7 });
    await waitFor(() => harness.fake.configurationUpdates.length === 1);
    assert.deepEqual(harness.fake.configurationUpdates[0], {
      key: 'maxLines',
      value: 7,
      target: FakeVscode.ConfigurationTarget.Global
    });
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor reports fetch and settings update handler failures', async () => {
  const fetchHarness = loadExtension({
    fetchJsonlRows: async () => {
      throw new Error('fetch failed');
    }
  });
  const fetchPanel = new FakeWebviewPanel();
  try {
    fetchHarness.fake.maxLines = 0;
    const provider = activateAndGetProvider(fetchHarness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('fetch-fails.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, fetchPanel, {});
    fetchPanel.webview.receive({ type: 'ready' });
    await waitForMessage(
      fetchPanel,
      (message) => message.type === 'fullIndexReady'
    );

    fetchPanel.webview.receive({
      type: 'fetchRows',
      requestId: 'failed-fetch',
      start: 0,
      count: 1
    });
    const fetchError = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(fetchPanel, (message) => message.type === 'error');
    assert.equal(fetchError.message, 'fetch failed');
  } finally {
    fetchPanel.dispose();
    fetchHarness.restore();
  }

  const settingsHarness = loadExtension();
  const settingsPanel = new FakeWebviewPanel();
  try {
    settingsHarness.fake.configurationUpdateError = new Error(
      'settings failed'
    );
    const provider = activateAndGetProvider(settingsHarness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('settings-fail.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, settingsPanel, {});

    settingsPanel.webview.receive({ type: 'updateMaxLines', value: 8 });
    const settingsError = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(settingsPanel, (message) => message.type === 'maxLinesError');
    assert.equal(settingsError.message, 'settings failed');
  } finally {
    settingsPanel.dispose();
    settingsHarness.restore();
  }
});

test('custom editor reloads on settings and matching file saves', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('reload.jsonl', '{"a":1}\n{"b":2}');
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.indent']);
    await waitForMessage(panel, (message) => message.type === 'loading');

    panel.webview.messages.length = 0;
    harness.fake.fireSave(uri);
    await waitForMessage(panel, (message) => message.type === 'loading', 1_000);

    const listenerCount = harness.fake.saveListeners.length;
    panel.dispose();
    assert.ok(
      harness.fake.saveListeners
        .slice(0, listenerCount)
        .every((item) => item.disposed)
    );
  } finally {
    harness.restore();
  }
});

test('native file watcher filters events and disposes pending reloads', async () => {
  let watchCallback:
    | ((_eventType: string, changedFileName?: string | Buffer) => void)
    | undefined;
  let closeCalls = 0;
  const harness = loadExtension(
    {},
    {
      watch: (
        _directory: string,
        callback: (
          _eventType: string,
          changedFileName?: string | Buffer
        ) => void
      ) => {
        watchCallback = callback;
        return {
          on: () => undefined,
          close: () => {
            closeCalls += 1;
          }
        };
      }
    }
  );
  const filePath = await writeFixture('watched.jsonl', '{"a":1}\n{"b":2}');
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    assert.ok(watchCallback);

    watchCallback?.('change', path.basename(filePath));
    assert.equal(panel.webview.messages.length, 0);

    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    watchCallback?.('change', 'other.jsonl');
    await sleep(200);
    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'loading'
      ),
      false
    );

    watchCallback?.('change', Buffer.from(path.basename(filePath)));
    await waitForMessage(panel, (message) => message.type === 'loading');
    await waitForMessage(panel, (message) => message.type === 'data');

    harness.fake.fireSave(uri);
    panel.dispose();
    assert.equal(closeCalls, 1);
  } finally {
    harness.restore();
  }
});

test('custom editor tolerates native watcher setup failures', async () => {
  const harness = loadExtension(
    {},
    {
      watch: () => {
        throw new Error('watch unavailable');
      }
    }
  );
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('watch-fails.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor reports unsupported schemes and missing files', async () => {
  const harness = loadExtension();
  try {
    const provider = activateAndGetProvider(harness);

    const unsupportedPanel = new FakeWebviewPanel();
    const unsupported = await provider.openCustomDocument(
      new FakeUri('/remote/data.jsonl', 'vscode-remote')
    );
    await provider.resolveCustomEditor(unsupported, unsupportedPanel, {});
    unsupportedPanel.webview.receive({ type: 'ready' });
    const unsupportedError = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(unsupportedPanel, (message) => message.type === 'error');
    assert.match(
      unsupportedError.message,
      /Unsupported URI scheme: vscode-remote/
    );
    unsupportedPanel.dispose();

    const missingPanel = new FakeWebviewPanel();
    const missing = await provider.openCustomDocument(
      FakeUri.file(path.join(tempDir, 'does-not-exist.jsonl'))
    );
    await provider.resolveCustomEditor(missing, missingPanel, {});
    missingPanel.webview.receive({ type: 'ready' });
    const missingError = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(missingPanel, (message) => message.type === 'error');
    assert.match(missingError.message, /ENOENT/);
    missingPanel.dispose();
  } finally {
    harness.restore();
  }
});

test('fetchRows before indexing reports an error', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('no-index-yet.jsonl', '{"a":1}');
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(FakeUri.file(filePath));
    await provider.resolveCustomEditor(document, panel, {});

    panel.webview.receive({ type: 'fetchRows', requestId: 'early' });
    const error = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(panel, (message) => message.type === 'error');
    assert.equal(error.message, 'The full-file index is not ready yet.');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('line count failures are posted while aborts and stale snapshots stay quiet', async () => {
  const failingHarness = loadExtension({
    countJsonlLines: async () => {
      throw new Error('count failed');
    }
  });
  const failingPanel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(failingHarness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('count-fails.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, failingPanel, {});
    failingPanel.webview.receive({ type: 'ready' });
    await waitForMessage(failingPanel, (message) => message.type === 'data');
    const error = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(failingPanel, (message) => message.type === 'lineCountError');
    assert.equal(error.message, 'count failed');
  } finally {
    failingPanel.dispose();
    failingHarness.restore();
  }

  const abortHarness = loadExtension({
    countJsonlLines: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  });
  const abortPanel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(abortHarness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('count-aborts.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, abortPanel, {});
    abortPanel.webview.receive({ type: 'ready' });
    await waitForMessage(abortPanel, (message) => message.type === 'data');
    await sleep(20);
    assert.equal(
      abortPanel.webview.messages.some(
        (message) => getMessageType(message) === 'lineCountError'
      ),
      false
    );
  } finally {
    abortPanel.dispose();
    abortHarness.restore();
  }

  let releaseCount: (() => void) | undefined;
  const staleHarness = loadExtension({
    countJsonlLines: async (
      _filePath: string,
      options: { readonly onProgress?: (event: unknown) => void }
    ) => {
      await new Promise<void>((resolve) => {
        releaseCount = resolve;
      });
      options.onProgress?.({
        bytesRead: 1,
        totalBytes: 1,
        percent: 100,
        lineCount: 1
      });
      return 1;
    }
  });
  const stalePanel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(staleHarness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('count-stale.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, stalePanel, {});
    stalePanel.webview.receive({ type: 'ready' });
    await waitForMessage(stalePanel, (message) => message.type === 'data');
    stalePanel.dispose();
    releaseCount?.();
    await sleep(20);
    assert.equal(
      stalePanel.webview.messages.some(
        (message) =>
          getMessageType(message) === 'lineCount' ||
          getMessageType(message) === 'lineCountProgress'
      ),
      false
    );
  } finally {
    staleHarness.restore();
  }
});

test('stale row fetch responses are dropped after a newer generation starts', async () => {
  let resolveRows:
    | ((rows: {
        readonly start: number;
        readonly entries: unknown[];
        readonly indexedLineCount: number;
      }) => void)
    | undefined;
  const harness = loadExtension({
    fetchJsonlRows: async () =>
      new Promise((resolve) => {
        resolveRows = resolve;
      })
  });
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 0;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(
      await writeFixture('stale-fetch.jsonl', '{"a":1}\n{"b":2}')
    );
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'stale',
      start: 0,
      count: 1
    });
    harness.fake.fireConfigurationChange(['quickJsonlViewer.maxLines']);
    resolveRows?.({
      start: 0,
      entries: [],
      indexedLineCount: 2
    });
    await sleep(50);

    assert.equal(
      panel.webview.messages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'requestId' in message &&
          message.requestId === 'stale'
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('stale full-index progress and completion are ignored', async () => {
  let progressFirst:
    | ((progress: {
        readonly bytesRead: number;
        readonly totalBytes: number;
        readonly percent: number;
        readonly indexedLineCount: number;
      }) => void)
    | undefined;
  let resolveFirst: (() => void) | undefined;
  let calls = 0;
  const contents = '{"a":1}\n{"b":2}';
  const fileSize = Buffer.byteLength(contents);
  const harness = loadExtension({
    indexJsonlFile: async (
      _filePath: string,
      options: {
        readonly onProgress?: typeof progressFirst;
      }
    ) => {
      calls += 1;
      if (calls === 1) {
        progressFirst = options.onProgress;
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }

      return {
        fileSize,
        lineOffsets: [0, 8],
        indexedLineCount: 2,
        indexedEndOffset: fileSize,
        isComplete: true
      };
    }
  });
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 0;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(await writeFixture('stale-index.jsonl', contents));
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexStart');

    harness.fake.fireConfigurationChange(['quickJsonlViewer.maxLines']);
    await waitFor(() => calls === 2);
    progressFirst?.({
      bytesRead: fileSize,
      totalBytes: fileSize,
      percent: 100,
      indexedLineCount: 2
    });
    resolveFirst?.();
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');

    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'fullIndexProgress'
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('incomplete indexed previews start exact line counting', async () => {
  const countCalls: string[] = [];
  const contents = Array.from({ length: 201 }, (_, index) =>
    JSON.stringify({ index })
  ).join('\n');
  const harness = loadExtension({
    countJsonlLines: async (filePath: string) => {
      countCalls.push(filePath);
      return 201;
    }
  });
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 200;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(
      await writeFixture('indexed-preview.jsonl', contents)
    );
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');
    await waitFor(() => countCalls.length === 1);
    await waitForMessage(panel, (message) => message.type === 'lineCount');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('stale preview progress and completion are ignored', async () => {
  let progressFirst:
    | ((progress: {
        readonly loadedLineCount: number;
        readonly displayLimit: number;
        readonly percent: number;
      }) => void)
    | undefined;
  let resolveFirst: (() => void) | undefined;
  let calls = 0;
  const harness = loadExtension({
    readJsonlPreview: async (
      _filePath: string,
      settings: { readonly maxLines: number },
      options: { readonly onProgress?: typeof progressFirst }
    ) => {
      calls += 1;
      if (calls === 1) {
        progressFirst = options.onProgress;
        await new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      }

      return {
        entries: [],
        plainText: '',
        loadedLineCount: 0,
        displayLimit: settings.maxLines
      };
    }
  });
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(
      await writeFixture('stale-preview.jsonl', '{"a":1}')
    );
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(
      panel,
      (message) => message.type === 'previewLoadStart'
    );

    harness.fake.fireConfigurationChange(['quickJsonlViewer.indent']);
    await waitFor(() => calls === 2);
    progressFirst?.({
      loadedLineCount: 1,
      displayLimit: 20,
      percent: 5
    });
    resolveFirst?.();
    await waitForMessage(panel, (message) => message.type === 'data');

    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'previewLoadProgress'
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('stale preview errors are ignored after a newer generation starts', async () => {
  let rejectFirst: ((error: Error) => void) | undefined;
  let calls = 0;
  const harness = loadExtension({
    readJsonlPreview: async (
      _filePath: string,
      settings: { readonly maxLines: number }
    ) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        });
      }

      return {
        entries: [],
        plainText: '',
        loadedLineCount: 0,
        displayLimit: settings.maxLines
      };
    }
  });
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(
      await writeFixture('stale-preview-error.jsonl', '{"a":1}')
    );
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(
      panel,
      (message) => message.type === 'previewLoadStart'
    );

    harness.fake.fireConfigurationChange(['quickJsonlViewer.indent']);
    await waitFor(() => calls === 2);
    rejectFirst?.(new Error('stale failure'));
    await sleep(20);

    assert.equal(
      panel.webview.messages.some(
        (message) =>
          getMessageType(message) === 'error' &&
          typeof message === 'object' &&
          message !== null &&
          'message' in message &&
          message.message === 'stale failure'
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

function activateAndGetProvider(
  harness: ReturnType<typeof loadExtension>
): RegisteredProvider['provider'] {
  harness.extension.activate(createContext());
  const provider = harness.fake.providerRegistrations[0]?.provider;
  assert.ok(provider);
  return provider;
}

function createContext(extensionUri = FakeUri.file(tempDir)): {
  readonly extensionUri: FakeUri;
  readonly subscriptions: Disposable[];
} {
  return {
    extensionUri,
    subscriptions: []
  };
}

function getCommand(
  fake: FakeVscode,
  command: string
): (...args: unknown[]) => Promise<unknown> {
  const callback = fake.registeredCommands.get(command);
  assert.ok(callback);
  return async (...args: unknown[]) => callback(...args);
}

function loadExtension(
  jsonlOverrides: Record<string, unknown> = {},
  nodeFsOverrides: Record<string, unknown> = {}
): {
  readonly fake: FakeVscode;
  readonly extension: {
    activate(context: unknown): void;
    deactivate(): void;
  };
  readonly restore: () => void;
} {
  const fake = new FakeVscode();
  const realJsonl = require('../src/jsonl') as Record<string, unknown>;
  const realNodeFs = require('node:fs') as Record<string, unknown>;
  const loader = require('node:module') as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const originalLoad = loader._load;
  loader._load = function load(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === 'vscode') {
      return fake.vscode;
    }

    if (request === 'node:fs' && Object.keys(nodeFsOverrides).length > 0) {
      return {
        ...realNodeFs,
        ...nodeFsOverrides
      };
    }

    if (request === './jsonl') {
      return {
        ...realJsonl,
        ...jsonlOverrides
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  const extensionPath = '../src/extension';
  delete require.cache[require.resolve(extensionPath)];
  const extension = require(extensionPath) as {
    activate(context: unknown): void;
    deactivate(): void;
  };

  return {
    fake,
    extension,
    restore: () => {
      loader._load = originalLoad;
      delete require.cache[require.resolve(extensionPath)];
    }
  };
}

function disposable(): Disposable {
  return {
    dispose: () => undefined
  };
}

async function writeFixture(
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}

async function waitForMessage<T extends { readonly type?: unknown }>(
  panel: FakeWebviewPanel,
  predicate: (
    message: { readonly type?: unknown } & Record<string, unknown>
  ) => boolean,
  timeoutMs = 500
): Promise<T> {
  await waitFor(
    () =>
      panel.webview.messages.some((message) =>
        predicate(
          message as { readonly type?: unknown } & Record<string, unknown>
        )
      ),
    timeoutMs
  );
  const message = panel.webview.messages.find((item) =>
    predicate(item as { readonly type?: unknown } & Record<string, unknown>)
  );
  assert.ok(message);
  return message as T;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for test condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function getMessageType(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'type' in message
    ? message.type
    : undefined;
}

async function sleep(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
