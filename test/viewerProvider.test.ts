import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  FakeUri,
  FakeVscode,
  FakeWebviewPanel,
  activateAndGetProvider,
  getMessageType,
  loadExtension,
  sleep,
  tempDir,
  waitFor,
  waitForMessage,
  writeFixture
} from './support/extensionHarness';

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
    (document as unknown as { dispose(): void }).dispose();
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

    panel.webview.receive({
      type: 'fetchRows',
      start: 0,
      count: 1
    });
    const anonymousRows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
    }>(panel, (message) => message.type === 'rows' && message.requestId === '');
    assert.equal(anonymousRows.requestId, '');

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
  let watchErrorCallback: (() => void) | undefined;
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
          on: (eventName: string, listener: () => void) => {
            if (eventName === 'error') {
              watchErrorCallback = listener;
            }
          },
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
    assert.ok(watchErrorCallback);
    watchErrorCallback();

    watchCallback?.('change');
    assert.equal(panel.webview.messages.length, 0);

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

test('custom editor reports aborted preview loads as cancelled indexing', async () => {
  const harness = loadExtension({
    readJsonlPreview: async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  });
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('abort-preview.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(
      panel,
      (message) => message.type === 'fullIndexCancelled'
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor reports unexpected load failures from safeLoad', async () => {
  const harness = loadExtension();
  const panel = new FakeWebviewPanel();
  const originalPostMessage = panel.webview.postMessage.bind(panel.webview);
  try {
    panel.webview.postMessage = async (message: unknown): Promise<boolean> => {
      if (getMessageType(message) === 'loading') {
        throw 'load failed';
      }

      return originalPostMessage(message);
    };
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(
      FakeUri.file(await writeFixture('safe-load-fails.jsonl', '{"a":1}'))
    );
    await provider.resolveCustomEditor(document, panel, {});

    panel.webview.receive({ type: 'ready' });
    const error = await waitForMessage<{
      readonly type?: unknown;
      readonly message: string;
    }>(panel, (message) => message.type === 'error');
    assert.equal(error.message, 'load failed');
  } finally {
    panel.dispose();
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

test('exact line counting reuses matching in-flight and cached counts', async () => {
  let resolveCount: ((lineCount: number) => void) | undefined;
  const countCalls: string[] = [];
  const contents = Array.from({ length: 201 }, (_, index) =>
    JSON.stringify({ index })
  ).join('\n');
  const filePath = await writeFixture(
    'indexed-preview-count-cache.jsonl',
    contents
  );
  const uri = FakeUri.file(filePath);
  const realNodeFsPromises =
    require('node:fs/promises') as typeof import('node:fs/promises');
  const fixedMtime = new Date('2026-01-01T00:00:00.000Z');
  const harness = loadExtension(
    {
      countJsonlLines: async (filePath: string) => {
        countCalls.push(filePath);
        return new Promise<number>((resolve) => {
          resolveCount = resolve;
        });
      }
    },
    {
      watch: () => ({
        on: () => undefined,
        close: () => undefined
      })
    },
    {
      stat: async (target: unknown, ...args: unknown[]) => {
        if (target === uri.fsPath) {
          return {
            size: Buffer.byteLength(contents),
            mtime: fixedMtime,
            mtimeMs: fixedMtime.getTime()
          };
        }

        return realNodeFsPromises.stat(
          target as Parameters<typeof realNodeFsPromises.stat>[0],
          ...(args as [])
        );
      }
    }
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 200;
    const provider = activateAndGetProvider(harness);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');
    await waitFor(() => countCalls.length === 1);

    panel.webview.messages.length = 0;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.indent']);
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');
    await sleep(20);
    assert.equal(countCalls.length, 1);

    resolveCount?.(201);
    await waitForMessage(panel, (message) => message.type === 'lineCount');

    panel.webview.messages.length = 0;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.indent']);
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');
    await sleep(20);
    assert.equal(countCalls.length, 1);
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
