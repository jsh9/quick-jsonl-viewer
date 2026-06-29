import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  FakeTabInputTextDiff,
  FakeUri,
  FakeVscode,
  FakeWebviewPanel,
  activateAndGetProvider,
  getMessageType,
  loadExtension,
  sleep,
  tempDir,
  thisOwner,
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
    // Verifies initial global auto-refresh state drives both controls before
    // data loads, so the webview does not briefly offer the wrong action.
    assert.match(
      panel.webview.html,
      /id="auto-refresh" type="checkbox" checked/
    );
    assert.match(
      panel.webview.html,
      /id="indent-guides" type="checkbox" checked/
    );
    assert.match(panel.webview.html, /id="refresh" hidden>Refresh/);
    assert.deepEqual(panel.revealCalls, [[FakeVscode.ViewColumn.One, false]]);
    assert.equal(panel.webview.messages.length, 0);

    panel.webview.receive({ type: 'ready' });
    const autoRefresh = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    const indentGuides = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(panel, (message) => message.type === 'indentGuidesChanged');
    const data = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly preview: { readonly entries: unknown[] };
      };
    }>(panel, (message) => message.type === 'data');

    assert.equal(autoRefresh.autoRefresh, true);
    assert.equal(indentGuides.indentGuides, true);
    // Ready sends preference-only messages before data loading, and data
    // payloads must omit those fields so stale loads cannot flip controls back.
    assert.equal('autoRefresh' in data.payload, false);
    assert.equal('indentGuides' in data.payload, false);
    assert.equal(data.payload.startLine, 1);
    assert.equal(data.payload.preview.entries.length, 2);
    assert.deepEqual(
      panel.webview.messages
        .map((message) => getMessageType(message))
        .slice(0, 5),
      [
        'autoRefreshChanged',
        'indentGuidesChanged',
        'loading',
        'previewLoadStart',
        'previewLoadProgress'
      ]
    );
    (document as unknown as { dispose(): void }).dispose();
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor can start limited previews from a per-view line', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'middle-limited.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}\n{"d":4}'
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 2;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    // Verifies Start at line begins as an editor-local default and updates via
    // webview message without writing the removed global setting.
    const initialData = await waitForMessage<{
      readonly type: string;
      readonly payload: { readonly startLine: number };
    }>(panel, (message) => message.type === 'data');
    assert.equal(initialData.payload.startLine, 1);

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateStartLine', value: 3 });
    const data = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly preview: {
          readonly entries: Array<{
            readonly lineNumber: number;
            readonly raw: string;
          }>;
        };
      };
    }>(panel, (message) => message.type === 'data');

    assert.equal(data.payload.startLine, 3);
    assert.deepEqual(
      data.payload.preview.entries.map((entry) => entry.lineNumber),
      [3, 4]
    );
    assert.deepEqual(
      data.payload.preview.entries.map((entry) => entry.raw),
      ['{"c":3}', '{"d":4}']
    );
    // Nearby Start at line jumps should stay on the lightweight preview path;
    // indexed loading is reserved for distant skips and large previews.
    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'fullIndexStart'
      ),
      false
    );
    assert.equal(harness.fake.configurationUpdates.length, 0);
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor applies configured oversized row limits to previews', async () => {
  const harness = loadExtension();
  const oversizedRaw = '{"message":"' + 'x'.repeat(40) + '"}';
  const filePath = await writeFixture(
    'configured-preview-limit.jsonl',
    oversizedRaw + '\n{"ok":true}'
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 2;
    harness.fake.maxRenderedRowBytes = 16;
    harness.fake.oversizedRowPreviewBytes = 12;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    const data = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly preview: {
          readonly entries: Array<{
            readonly kind: string;
            readonly byteLength?: number;
            readonly limitBytes?: number;
            readonly preview?: string;
          }>;
          readonly plainText: string;
        };
      };
    }>(panel, (message) => message.type === 'data');

    assert.equal(data.payload.preview.entries[0]?.kind, 'oversized');
    assert.equal(
      data.payload.preview.entries[0]?.byteLength,
      Buffer.byteLength(oversizedRaw)
    );
    assert.equal(data.payload.preview.entries[0]?.limitBytes, 16);
    assert.equal(data.payload.preview.entries[0]?.preview, '{"message":" ...');
    assert.equal(
      data.payload.preview.plainText,
      '{"message":" ...\n{"ok":true}'
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor keeps start line local to each viewer', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'local-start.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}'
  );
  const firstPanel = new FakeWebviewPanel();
  const secondPanel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 2;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const firstDocument = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(firstDocument, firstPanel, {});
    firstPanel.webview.receive({ type: 'ready' });
    await waitForMessage(firstPanel, (message) => message.type === 'data');

    // Regression guard: changing one viewer's start line must not leak into
    // another viewer for the same file or write a global setting.
    firstPanel.webview.messages.length = 0;
    firstPanel.webview.receive({ type: 'updateStartLine', value: 2 });
    const firstData = await waitForMessage<{
      readonly type: string;
      readonly payload: { readonly startLine: number };
    }>(firstPanel, (message) => message.type === 'data');
    assert.equal(firstData.payload.startLine, 2);

    const secondDocument = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(secondDocument, secondPanel, {});
    secondPanel.webview.receive({ type: 'ready' });
    const secondData = await waitForMessage<{
      readonly type: string;
      readonly payload: { readonly startLine: number };
    }>(secondPanel, (message) => message.type === 'data');
    assert.equal(secondData.payload.startLine, 1);
    assert.equal(harness.fake.configurationUpdates.length, 0);
  } finally {
    firstPanel.dispose();
    secondPanel.dispose();
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

test('custom editor can start indexed viewers from a per-view line', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'middle-full.jsonl',
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
    // Indexed mode has separate row-fetch math; keep the same per-view start
    // semantics there so virtual rows map to file line numbers correctly.
    const initialReady = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly totalRows: number;
      };
    }>(panel, (message) => message.type === 'fullIndexReady');
    assert.equal(initialReady.payload.startLine, 1);
    assert.equal(initialReady.payload.totalRows, 3);

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateStartLine', value: 2 });
    const ready = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly totalRows: number;
      };
    }>(panel, (message) => message.type === 'fullIndexReady');
    assert.equal(ready.payload.startLine, 2);
    assert.equal(ready.payload.totalRows, 2);

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'middle',
      start: 0,
      count: 2
    });
    const rows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly payload: {
        readonly start: number;
        readonly totalLines: number;
        readonly entries: Array<{
          readonly lineNumber: number;
          readonly raw: string;
        }>;
      };
    }>(panel, (message) => message.type === 'rows');
    assert.equal(rows.requestId, 'middle');
    assert.equal(rows.payload.start, 0);
    assert.equal(rows.payload.totalLines, 2);
    assert.deepEqual(
      rows.payload.entries.map((entry) => entry.lineNumber),
      [2, 3]
    );
    assert.deepEqual(
      rows.payload.entries.map((entry) => entry.raw),
      ['{"b":2}', '{"c":3}']
    );
    assert.equal(harness.fake.configurationUpdates.length, 0);
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor applies configured oversized row limits to indexed row fetches', async () => {
  const harness = loadExtension();
  const oversizedRaw = '{"message":"' + 'x'.repeat(40) + '"}';
  const filePath = await writeFixture(
    'configured-index-limit.jsonl',
    oversizedRaw + '\n{"ok":true}'
  );
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.maxLines = 0;
    harness.fake.maxRenderedRowBytes = 16;
    harness.fake.oversizedRowPreviewBytes = 12;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'fullIndexReady');

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'configured-limit',
      start: 0,
      count: 2
    });
    const rows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly payload: {
        readonly entries: Array<{
          readonly kind: string;
          readonly byteLength?: number;
          readonly limitBytes?: number;
          readonly preview?: string;
        }>;
      };
    }>(
      panel,
      (message) =>
        message.type === 'rows' && message.requestId === 'configured-limit'
    );

    assert.equal(rows.payload.entries[0]?.kind, 'oversized');
    assert.equal(
      rows.payload.entries[0]?.byteLength,
      Buffer.byteLength(oversizedRaw)
    );
    assert.equal(rows.payload.entries[0]?.limitBytes, 16);
    assert.equal(rows.payload.entries[0]?.preview, '{"message":" ...');
    assert.equal(rows.payload.entries[1]?.kind, 'json');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor indexes far start-line previews with the default row count', async () => {
  const harness = loadExtension();
  const contents = Array.from({ length: 225 }, (_, index) =>
    JSON.stringify({ index: index + 1 })
  ).join('\n');
  const filePath = await writeFixture('far-start-line.jsonl', contents);
  const panel = new FakeWebviewPanel();
  try {
    // Regression guard: a far Start at line request should switch to indexed
    // loading even with the default row count, so the viewer can report
    // progress and fetch rows by offset instead of streaming a long prefix.
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);

    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateStartLine', value: 201 });
    const start = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly maxLines: number;
      };
    }>(panel, (message) => message.type === 'fullIndexStart');
    assert.equal(start.payload.startLine, 201);
    assert.equal(start.payload.maxLines, 20);

    const ready = await waitForMessage<{
      readonly type: string;
      readonly payload: {
        readonly startLine: number;
        readonly totalRows: number;
        readonly isComplete: boolean;
      };
    }>(panel, (message) => message.type === 'fullIndexReady');
    assert.equal(ready.payload.startLine, 201);
    assert.equal(ready.payload.totalRows, 20);
    assert.equal(ready.payload.isComplete, false);

    panel.webview.receive({
      type: 'fetchRows',
      requestId: 'far-start',
      start: 0,
      count: 3
    });
    const rows = await waitForMessage<{
      readonly type: string;
      readonly requestId: string;
      readonly payload: {
        readonly start: number;
        readonly totalLines: number;
        readonly entries: Array<{
          readonly lineNumber: number;
          readonly raw: string;
        }>;
      };
    }>(panel, (message) => message.type === 'rows');
    assert.equal(rows.requestId, 'far-start');
    assert.equal(rows.payload.start, 0);
    assert.equal(rows.payload.totalLines, 20);
    assert.deepEqual(
      rows.payload.entries.map((entry) => entry.lineNumber),
      [201, 202, 203]
    );
    assert.deepEqual(
      rows.payload.entries.map((entry) => entry.raw),
      ['{"index":201}', '{"index":202}', '{"index":203}']
    );
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

    panel.webview.receive({ type: 'updateStartLine', value: 0 });
    await waitForMessage(panel, (message) => message.type === 'startLineError');

    const errorCount = panel.webview.messages.length;
    panel.webview.receive({ type: 'updateMaxLines', value: '7' });
    await waitFor(() =>
      panel.webview.messages
        .slice(errorCount)
        .some((message) => getMessageType(message) === 'maxLinesError')
    );

    const startLineErrorCount = panel.webview.messages.length;
    panel.webview.receive({ type: 'updateStartLine', value: '7' });
    await waitFor(() =>
      panel.webview.messages
        .slice(startLineErrorCount)
        .some((message) => getMessageType(message) === 'startLineError')
    );

    panel.webview.receive({ type: 'updateMaxLines', value: 7 });
    await waitFor(() => harness.fake.configurationUpdates.length === 1);
    assert.deepEqual(harness.fake.configurationUpdates[0], {
      key: 'maxLines',
      value: 7,
      target: FakeVscode.ConfigurationTarget.Global
    });

    panel.webview.receive({ type: 'updateStartLine', value: 5 });
    // A valid Start at line message reloads local view state only. The sleep
    // leaves room for accidental async configuration writes to appear.
    await sleep(20);
    assert.equal(harness.fake.configurationUpdates.length, 1);
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
    harness.fake.fireConfigurationChange([
      'quickJsonlViewer.maxRenderedRowBytes'
    ]);
    await waitForMessage(panel, (message) => message.type === 'loading');

    panel.webview.messages.length = 0;
    harness.fake.fireConfigurationChange([
      'quickJsonlViewer.oversizedRowPreviewBytes'
    ]);
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
    panel.dispose();
    harness.restore();
  }
});

test('custom editor can disable automatic reloads and refresh manually', async () => {
  let watchCallback:
    | ((_eventType: string, changedFileName?: string | Buffer) => void)
    | undefined;
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
          close: () => undefined
        };
      }
    }
  );
  const filePath = await writeFixture('manual-refresh.jsonl', '{"a":1}');
  const panel = new FakeWebviewPanel();
  try {
    harness.fake.autoRefresh = false;
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    // Initial HTML must expose the checkbox unchecked and manual Refresh
    // visible so disabled auto-refresh is controllable before first load.
    assert.match(panel.webview.html, /id="refresh">Refresh/);
    assert.doesNotMatch(panel.webview.html, /id="refresh" hidden/);
    assert.match(panel.webview.html, /id="auto-refresh" type="checkbox">/);
    panel.webview.receive({ type: 'ready' });
    const autoRefresh = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    const data = await waitForMessage<{
      readonly type?: unknown;
      readonly payload: Record<string, unknown>;
    }>(panel, (message) => message.type === 'data');
    // Refresh visibility comes from the dedicated preference message; data
    // payloads must not carry a stale auto-refresh value from an old load.
    assert.equal(autoRefresh.autoRefresh, false);
    assert.equal('autoRefresh' in data.payload, false);

    panel.webview.messages.length = 0;
    harness.fake.fireSave(uri);
    watchCallback?.('change', path.basename(filePath));
    await sleep(200);
    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'loading'
      ),
      false
    );

    panel.webview.receive({ type: 'refresh' });
    await waitForMessage(panel, (message) => message.type === 'loading');
    await waitForMessage(panel, (message) => message.type === 'data');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('delayed data loads cannot overwrite newer preference state', async () => {
  let finishPreview: (() => void) | undefined;
  const harness = loadExtension({
    readJsonlPreview: async (
      _filePath: string,
      settings: { readonly maxLines: number }
    ) => {
      await new Promise<void>((resolve) => {
        finishPreview = resolve;
      });

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
      await writeFixture('delayed-prefs.jsonl', '{"a":1}')
    );
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(
      panel,
      (message) => message.type === 'previewLoadStart'
    );

    panel.webview.messages.length = 0;
    harness.fake.autoRefresh = false;
    harness.fake.indentGuides = false;
    harness.fake.fireConfigurationChange([
      'quickJsonlViewer.autoRefresh',
      'quickJsonlViewer.indentGuides'
    ]);
    const autoRefresh = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    const indentGuides = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(panel, (message) => message.type === 'indentGuidesChanged');
    assert.equal(autoRefresh.autoRefresh, false);
    assert.equal(indentGuides.indentGuides, false);

    // Simulate a slow preview that began with old preferences. The final data
    // response must not contain preference fields that could revert newer
    // checkbox/config state in the webview.
    finishPreview?.();
    const data = await waitForMessage<{
      readonly type?: unknown;
      readonly payload: Record<string, unknown>;
    }>(panel, (message) => message.type === 'data');
    assert.equal('autoRefresh' in data.payload, false);
    assert.equal('indentGuides' in data.payload, false);
    assert.equal(
      panel.webview.messages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'autoRefreshChanged' &&
          'autoRefresh' in message &&
          message.autoRefresh === true
      ),
      false
    );
    assert.equal(
      panel.webview.messages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === 'indentGuidesChanged' &&
          'indentGuides' in message &&
          message.indentGuides === true
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor updates auto-refresh from the webview without reloading data', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('checkbox-auto-refresh.jsonl', '{"a":1}');
  const panel = new FakeWebviewPanel();
  try {
    // Verifies the checkbox writes the global preference but only posts
    // control state back; treating it as data reload would clear content.
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateAutoRefresh', value: false });
    await waitFor(() => harness.fake.configurationUpdates.length === 1);
    assert.deepEqual(harness.fake.configurationUpdates[0], {
      key: 'autoRefresh',
      value: false,
      target: FakeVscode.ConfigurationTarget.Global
    });
    const changed = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    assert.equal(changed.autoRefresh, false);
    assert.equal(
      panel.webview.messages.some(
        (message) =>
          getMessageType(message) === 'loading' ||
          getMessageType(message) === 'data'
      ),
      false
    );
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('custom editor updates indent guides from the webview without reloading data', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture(
    'checkbox-indent-guides.jsonl',
    '{"a":1}'
  );
  const panel = new FakeWebviewPanel();
  try {
    // Verifies the checkbox writes the global preference but only posts
    // render state back; treating it as data reload would clear content.
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateIndentGuides', value: false });
    await waitFor(() => harness.fake.configurationUpdates.length === 1);
    assert.deepEqual(harness.fake.configurationUpdates[0], {
      key: 'indentGuides',
      value: false,
      target: FakeVscode.ConfigurationTarget.Global
    });
    const changed = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(panel, (message) => message.type === 'indentGuidesChanged');
    assert.equal(changed.indentGuides, false);
    assert.equal(
      panel.webview.messages.some((message) =>
        ['loading', 'data', 'previewLoadStart', 'fullIndexStart'].some(
          (type) => type === getMessageType(message)
        )
      ),
      false
    );

    panel.webview.messages.length = 0;
    panel.webview.receive({ type: 'updateIndentGuides', value: 'bad' });
    const repaired = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(panel, (message) => message.type === 'indentGuidesChanged');
    assert.equal(repaired.indentGuides, false);
    assert.equal(harness.fake.configurationUpdates.length, 1);
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('auto-refresh setting changes update open viewers', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('toggle-auto-refresh.jsonl', '{"a":1}');
  const panel = new FakeWebviewPanel();
  try {
    // Verifies external setting changes are control-only messages while
    // save/watch reload behavior still respects the current preference.
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const document = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(document, panel, {});
    panel.webview.receive({ type: 'ready' });
    await waitForMessage(panel, (message) => message.type === 'data');

    panel.webview.messages.length = 0;
    harness.fake.autoRefresh = false;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.autoRefresh']);
    const disabledState = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    assert.equal(disabledState.autoRefresh, false);
    assert.equal(
      panel.webview.messages.some(
        (message) =>
          getMessageType(message) === 'loading' ||
          getMessageType(message) === 'data'
      ),
      false
    );

    panel.webview.messages.length = 0;
    harness.fake.fireSave(uri);
    await sleep(200);
    assert.equal(
      panel.webview.messages.some(
        (message) => getMessageType(message) === 'loading'
      ),
      false
    );

    harness.fake.autoRefresh = true;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.autoRefresh']);
    const enabledState = await waitForMessage<{
      readonly type?: unknown;
      readonly autoRefresh: boolean;
    }>(panel, (message) => message.type === 'autoRefreshChanged');
    assert.equal(enabledState.autoRefresh, true);

    panel.webview.messages.length = 0;
    harness.fake.fireSave(uri);
    await waitForMessage(panel, (message) => message.type === 'loading');
  } finally {
    panel.dispose();
    harness.restore();
  }
});

test('indent guide setting changes update open viewers without reloading data', async () => {
  const harness = loadExtension();
  const filePath = await writeFixture('toggle-indent-guides.jsonl', '{"a":1}');
  const firstPanel = new FakeWebviewPanel();
  const secondPanel = new FakeWebviewPanel();
  try {
    // Verifies the global setting is broadcast to every open viewer as a
    // render-only update, not as a file reload.
    const provider = activateAndGetProvider(harness);
    const uri = FakeUri.file(filePath);
    const firstDocument = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(firstDocument, firstPanel, {});
    firstPanel.webview.receive({ type: 'ready' });
    await waitForMessage(firstPanel, (message) => message.type === 'data');

    const secondDocument = await provider.openCustomDocument(uri);
    await provider.resolveCustomEditor(secondDocument, secondPanel, {});
    secondPanel.webview.receive({ type: 'ready' });
    await waitForMessage(secondPanel, (message) => message.type === 'data');

    firstPanel.webview.messages.length = 0;
    secondPanel.webview.messages.length = 0;
    harness.fake.indentGuides = false;
    harness.fake.fireConfigurationChange(['quickJsonlViewer.indentGuides']);
    const firstState = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(firstPanel, (message) => message.type === 'indentGuidesChanged');
    const secondState = await waitForMessage<{
      readonly type?: unknown;
      readonly indentGuides: boolean;
    }>(secondPanel, (message) => message.type === 'indentGuidesChanged');
    assert.equal(firstState.indentGuides, false);
    assert.equal(secondState.indentGuides, false);
    assert.equal(
      [...firstPanel.webview.messages, ...secondPanel.webview.messages].some(
        (message) =>
          ['loading', 'data', 'previewLoadStart', 'fullIndexStart'].some(
            (type) => type === getMessageType(message)
          )
      ),
      false
    );
  } finally {
    firstPanel.dispose();
    secondPanel.dispose();
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

test('custom editor opens requested files even when a matching diff is active', async () => {
  // Verifies explicit viewer opens are honored while a matching diff is active;
  // native diff handling is owned by VS Code's diff editor association.
  const harness = loadExtension();
  const panel = new FakeWebviewPanel();
  try {
    const provider = activateAndGetProvider(harness);
    const originalUri = FakeUri.file(path.join(tempDir, 'original.jsonl'));
    const modifiedUri = FakeUri.file(
      await writeFixture('modified.jsonl', '{"a":1}')
    );
    harness.fake.activeTabInput = new FakeTabInputTextDiff(
      originalUri,
      modifiedUri
    );
    thisOwner.activeTabInput = harness.fake.activeTabInput;
    const document = await provider.openCustomDocument(modifiedUri);

    await provider.resolveCustomEditor(document, panel, {});

    assert.equal(panel.disposed, false);
    assert.deepEqual(panel.webview.options, { enableScripts: true });
    assert.match(panel.webview.html, /id="content"/);
    assert.equal(harness.fake.executedCommands.length, 0);
  } finally {
    panel.dispose();
    thisOwner.activeTabInput = undefined;
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
