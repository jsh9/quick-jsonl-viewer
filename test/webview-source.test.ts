import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

const SOURCE_FILES = [
  'src/extension.ts',
  'src/constants.ts',
  'src/commands.ts',
  'src/viewerProvider.ts',
  'src/viewerData.ts',
  'src/viewerProtocol.ts',
  'src/webview/html.ts',
  'src/webview/styles.ts',
  'src/webview/script.ts',
  'src/shared/jsonlConstants.ts',
  'src/webview/app/main.ts',
  'src/webview/app/app.ts',
  'src/webview/app/dom.ts',
  'src/webview/app/render.ts',
  'src/webview/app/sourceContracts.ts',
  'src/webview/lib/format.ts',
  'src/webview/lib/highlight.ts',
  'src/webview/lib/protocol.ts',
  'src/webview/lib/virtualScroll.ts',
  'out/webview/main.js'
];

async function readExtensionSource(): Promise<string> {
  const sources = await Promise.all(
    SOURCE_FILES.map((sourceFile) =>
      fs.readFile(path.join(process.cwd(), sourceFile), 'utf8')
    )
  );

  return sources.join('\n');
}

test('custom editor enables the VS Code find widget for webview search', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /webviewOptions: \{[\s\S]*?enableFindWidget: true,[\s\S]*?retainContextWhenHidden: true/
  );
});

test('custom editor focuses the webview so find shortcuts work after open', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /webviewPanel\.webview\.html = getHtml\(path\.basename\(document\.uri\.fsPath\)\);\s*webviewPanel\.reveal\(webviewPanel\.viewColumn, false\);/
  );
  assert.match(source, /<main id="content" tabindex="-1">/);
  assert.match(source, /content\.focus\(\{ preventScroll: true \}\);/);
});

test('webview top bar labels use colons, separators, and Show rows wording', async () => {
  const source = await readExtensionSource();

  assert.match(source, /<strong>Size:<\/strong>/);
  assert.match(source, /<strong>Total lines:<\/strong>/);
  assert.match(source, /<strong>Show<\/strong>[\s\S]*<span>rows<\/span>/);
  assert.match(source, /<strong>Modified:<\/strong>/);
  assert.match(
    source,
    /\.info-item:not\(:first-child\)::before[\s\S]*content: "\|";/
  );
});

test('raw-line virtual rows stay unwrapped without fixed-height clipping', async () => {
  const source = await readExtensionSource();

  assert.match(source, /\.entry\.raw-line pre[\s\S]*white-space: pre;/);
  assert.match(
    source,
    /\.virtual-row\.raw-line \.line-body[\s\S]*overflow-x: auto;/
  );
  assert.doesNotMatch(source, /\.virtual-row\.raw-line\s*\{[\s\S]*?height:/);
  assert.doesNotMatch(
    source,
    /\.virtual-row\.raw-line \.line-body\s*\{[\s\S]*?overflow-y: hidden;/
  );
});

test('rows input rejects empty values before posting maxLines updates', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const rawValue = rowsInput\.value\.trim\(\);/);
  assert.match(
    source,
    /if \(rawValue === ''\) \{[\s\S]*?showRowsError\('Rows must be 0 or a positive whole number\.'\);[\s\S]*?return;/
  );
  assert.match(source, /const value = Number\(rawValue\);/);
});

test('rows input hides native number spinner controls', async () => {
  const source = await readExtensionSource();

  assert.match(
    source,
    /\.rows-input \{[\s\S]*?appearance: textfield;[\s\S]*?-moz-appearance: textfield;/
  );
  assert.match(
    source,
    /\.rows-input::-webkit-inner-spin-button,\s*\.rows-input::-webkit-outer-spin-button \{[\s\S]*?-webkit-appearance: none;/
  );
});

test('line count errors persist through webview rerenders', async () => {
  const source = await readExtensionSource();

  // Verifies line-count failures are stored in webview state, not only in the
  // DOM, because mode changes rerender the info bar from that state.
  assert.match(
    source,
    /function withLineCountState\(payload\) \{[\s\S]*?lineCountState: payload\.lineCount === null \? 'counting' : 'ready'/
  );
  assert.match(
    source,
    /if \(message\.type === 'lineCountError'\) \{[\s\S]*?data\.lineCountState = 'unavailable';[\s\S]*?renderLimitedInfo\(\);/
  );
  assert.match(
    source,
    /if \(message\.type === 'lineCountError'\) \{[\s\S]*?full\.lineCountState = 'unavailable';[\s\S]*?renderFullInfo\(\);/
  );
  assert.match(
    source,
    /function setLineCountText\(state, value, progress\) \{[\s\S]*?state === 'unavailable'[\s\S]*?lineCount\.textContent = 'Unavailable';/
  );
});

test('open viewers reload when their file changes', async () => {
  const source = await readExtensionSource();

  // Verifies both VS Code save events and native file-watch events are wired
  // through a debounce; without this, indexed viewers can keep stale offsets
  // after the underlying JSONL file changes.
  assert.match(source, /const FILE_RELOAD_DEBOUNCE_MS = 150;/);
  assert.match(
    source,
    /const scheduleFileReload = \(\): void => \{[\s\S]*?invalidateExactLineCount\(\);[\s\S]*?fileReloadTimer = setTimeout/
  );
  assert.match(
    source,
    /const scheduleFileReload = \(\): void => \{[\s\S]*?setTimeout\(\(\) => \{[\s\S]*?safeLoad\(\);[\s\S]*?\}, FILE_RELOAD_DEBOUNCE_MS\);/
  );
  assert.match(
    source,
    /vscode\.workspace\.onDidSaveTextDocument\(\(textDocument\) => \{[\s\S]*?scheduleFileReload\(\);/
  );
  assert.match(
    source,
    /nodeFs\.watch\(\s*path\.dirname\(document\.uri\.fsPath\),\s*\(_eventType,\s*changedFileName\) => \{[\s\S]*?changedName ===\s*path\.basename\(document\.uri\.fsPath\)[\s\S]*?scheduleFileReload\(\);/
  );
  assert.match(
    source,
    /if \(fileReloadTimer\) \{[\s\S]*?clearTimeout\(fileReloadTimer\);[\s\S]*?\}/
  );
});

test('line count progress is posted and rendered', async () => {
  const source = await readExtensionSource();

  // Verifies the extension streams count progress and the webview preserves
  // it in render state; mode changes should not collapse the UI back to an
  // uninformative "Counting..." label during long scans.
  assert.match(
    source,
    /onProgress: \(progress\) => \{[\s\S]*?type: 'lineCountProgress',[\s\S]*?payload: progress/
  );
  assert.match(
    source,
    /if \(message\.type === 'lineCountProgress'\) \{[\s\S]*?data\.lineCountState = 'counting';[\s\S]*?data\.lineCountProgress = progress;/
  );
  assert.match(
    source,
    /if \(message\.type === 'lineCountProgress'\) \{[\s\S]*?full\.lineCountState = 'counting';[\s\S]*?full\.lineCountProgress = progress;/
  );
  assert.match(source, /function normalizeLineCountProgress\(payload\) \{/);
  assert.match(
    source,
    /lineCount\.textContent = progress \? 'Counting ' \+ formatPercent\(progress\.percent\) : 'Counting\.\.\.';/
  );
});

test('line counts are cached across settings-only reloads', async () => {
  const source = await readExtensionSource();
  const configurationReload =
    /vscode\.workspace\.onDidChangeConfiguration\(\(event\) => \{([\s\S]*?)\n      \}\)/.exec(
      source
    )?.[1] ?? '';

  // Verifies row-count settings can rerender the viewer without restarting
  // the file-scoped exact count. Only file snapshot changes should invalidate
  // cached or in-flight line-count work.
  assert.match(
    source,
    /interface FileSnapshot \{[\s\S]*?readonly size: number;[\s\S]*?readonly mtimeMs: number;/
  );
  assert.match(
    source,
    /let exactLineCountCache: ExactLineCountCache \| undefined;/
  );
  assert.match(
    source,
    /let exactLineCountRequest: ExactLineCountRequest \| undefined;/
  );
  assert.match(configurationReload, /safeLoad\(\);/);
  assert.doesNotMatch(
    configurationReload,
    /invalidateExactLineCount|abortExactLineCount|ensureExactLineCount/
  );
});

test('file snapshot changes invalidate exact line counts', async () => {
  const source = await readExtensionSource();

  // Verifies exact counts are tied to the observed file version, not to a
  // particular render. Save/watch reloads re-stat the file, and a changed
  // snapshot aborts stale count work before new data is posted.
  assert.match(
    source,
    /function getFileSnapshot\(\s*stats: Pick<nodeFs\.Stats, 'size' \| 'mtimeMs'>\s*\): FileSnapshot/
  );
  assert.match(
    source,
    /function isSameFileSnapshot\(\s*left: FileSnapshot,\s*right: FileSnapshot\s*\): boolean \{[\s\S]*?left\.size === right\.size && left\.mtimeMs === right\.mtimeMs/
  );
  assert.match(
    source,
    /const noteFileSnapshot = \(snapshot: FileSnapshot\): void => \{[\s\S]*?invalidateExactLineCount\(\);[\s\S]*?currentFileSnapshot = snapshot;/
  );
  assert.match(
    source,
    /const snapshot = getFileSnapshot\(stats\);[\s\S]*?exactLineCounts\.noteFileSnapshot\(snapshot\);/
  );
});

test('exact line counting reuses cache and in-flight requests', async () => {
  const source = await readExtensionSource();

  // Verifies line counting is single-flight per file snapshot. Settings
  // changes can call ensure again, but a matching cached or running count
  // prevents a second full-file scan.
  assert.match(
    source,
    /const getCachedLineCount = \(snapshot: FileSnapshot\): number \| undefined =>[\s\S]*?isSameFileSnapshot\(exactLineCountCache\.snapshot, snapshot\)/
  );
  assert.match(
    source,
    /const ensureExactLineCount = \(snapshot: FileSnapshot\): void => \{[\s\S]*?if \(getCachedLineCount\(snapshot\) !== undefined\) \{[\s\S]*?return;[\s\S]*?if \(\s*exactLineCountRequest &&\s*isSameFileSnapshot\(exactLineCountRequest\.snapshot, snapshot\)\s*\) \{[\s\S]*?return;/
  );
  assert.match(
    source,
    /lineCount: exactLineCounts\.getCachedLineCount\(snapshot\) \?\? null,/
  );
  assert.match(
    source,
    /if \(index\.isComplete\) \{[\s\S]*?exactLineCounts\.setCachedLineCount\(\s*snapshot,\s*index\.indexedLineCount\s*\);/
  );
  assert.match(source, /lineCount: lineCount \?\? null,/);
});

test('virtual scrolling uses capped physical spacer and logical offsets', async () => {
  const source = await readExtensionSource();

  // Verifies huge logical row ranges are mapped onto a capped physical
  // scrollbar, because Chromium webviews can clamp very tall elements.
  // Also verifies measured row heights are pruned so long scroll sessions do
  // not make every virtual offset lookup scan an unbounded cache.
  assert.match(source, /const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;/);
  assert.match(source, /const MAX_MEASURED_ROW_HEIGHTS = 512;/);
  assert.match(
    source,
    /function getVirtualSpacerHeight\(totalRows, rowMode = mode\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows, rowMode\), MAX_VIRTUAL_SCROLL_HEIGHT\)/
  );
  assert.match(
    source,
    /function scrollToLogicalOffset\(scrollOffset, totalRows, viewportHeight, rowMode = mode\)/
  );
  assert.match(
    source,
    /function getLogicalViewportBottom\(logicalScrollTop, totalRows, viewportHeight, rowMode = mode\)/
  );
  assert.match(
    source,
    /function logicalToPhysicalOffset\(logicalOffset, totalRows, viewportHeight, rowMode = mode\)/
  );
  assert.match(
    source,
    /function pruneMeasuredRowHeights\(start, count\) \{[\s\S]*?measuredRowHeights\.size <= MAX_MEASURED_ROW_HEIGHTS/
  );
  assert.match(source, /pruneMeasuredRowHeights\(start, entries\.length\);/);
  assert.match(source, /measuredRowHeights\.delete\(index\);/);
  assert.match(
    source,
    /getIndexAtScrollOffset\(logicalScrollTop, full\.totalRows\)/
  );
  // Locks bottom-edge lookup to the helper; otherwise bottom-of-file requests
  // can stop at the scroll-top maximum and omit final visible rows.
  assert.match(
    source,
    /const logicalScrollBottom = getLogicalViewportBottom\(\s*logicalScrollTop,\s*full\.totalRows,\s*virtualScroll\.clientHeight\s*\);/
  );
  assert.match(
    source,
    /const logicalScrollBottom = getLogicalViewportBottom\(\s*logicalScrollTop,\s*totalRows,\s*virtualScroll\.clientHeight\s*\);/
  );
  assert.match(
    source,
    /logicalToPhysicalOffset\(getVirtualOffset\(start, rowMode\), totalRows, virtualScroll\.clientHeight, rowMode\)/
  );
});

test('virtual scrolling maps viewport bottom to full logical height', async () => {
  const source = await readExtensionSource();

  // Verifies the bottom edge clamps to the content height, not the scroll-top
  // maximum, so bottom-of-file requests include the final visible rows.
  assert.match(
    source,
    /function getLogicalViewportBottom\(logicalScrollTop, totalRows, viewportHeight, rowMode = mode\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows, rowMode\), logicalScrollTop \+ viewportHeight\)/
  );
});

test('virtual scrolling keeps non-scrollable offsets inside logical height', async () => {
  const source = await readExtensionSource();

  // Verifies a zero scroll range does not collapse every offset to the top.
  assert.match(
    source,
    /if \(logicalMax === 0 \|\| physicalMax === 0\) \{\s*return Math\.max\(0, Math\.min\(logicalHeight, scrollOffset\)\);\s*\}/
  );
});

test('webview HTML uses nonce-based CSP and escapes the document title', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const nonce = getNonce\(\);/);
  assert.match(source, /const escapedTitle = escapeHtml\(fileName\);/);
  assert.match(
    source,
    /Content-Security-Policy" content="default-src 'none'; style-src 'nonce-\$\{nonce\}'; script-src 'nonce-\$\{nonce\}';"/
  );
  assert.match(source, /<title>\$\{escapedTitle\}<\/title>/);
  assert.match(source, /<style nonce="\$\{nonce\}">/);
  assert.match(source, /<script nonce="\$\{nonce\}">/);
  assert.match(source, /function escapeHtml\(value: string\): string \{/);
});

test('webview avoids unsafe HTML injection APIs', async () => {
  const source = await readExtensionSource();
  const webviewSource = source.slice(source.indexOf('function getHtml'));

  assert.doesNotMatch(webviewSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(webviewSource, /insertAdjacentHTML/);
  assert.doesNotMatch(webviewSource, /document\.write/);
  assert.match(webviewSource, /textContent =/);
  assert.match(webviewSource, /document\.createTextNode\(text\)/);
});

test('webview handles the expected extension message protocol', async () => {
  const source = await readExtensionSource();

  for (const messageType of [
    'loading',
    'data',
    'lineCount',
    'lineCountProgress',
    'lineCountError',
    'maxLinesError',
    'previewLoadStart',
    'previewLoadProgress',
    'fullIndexStart',
    'fullIndexProgress',
    'fullIndexReady',
    'fullIndexCancelled',
    'rows',
    'error'
  ]) {
    assert.match(source, new RegExp(`message\\.type === '${messageType}'`));
  }

  for (const postedType of [
    'ready',
    'rawContents',
    'cancelIndex',
    'fetchRows',
    'updateMaxLines'
  ]) {
    assert.match(source, new RegExp(`type: '${postedType}'`));
  }
});

test('webview rejects stale row responses before rendering virtual rows', async () => {
  const source = await readExtensionSource();

  assert.match(source, /let pendingRequestId = '';/);
  assert.match(source, /pendingRequestId = requestId;/);
  assert.match(
    source,
    /if \(message\.requestId !== pendingRequestId \|\| viewState !== 'fullReady'\) \{[\s\S]*?return;[\s\S]*?\}/
  );
  assert.match(
    source,
    /renderVirtualRows\(message\.payload\.start, message\.payload\.entries, message\.payload\.totalLines, message\.mode\);/
  );
});

test('webview rows input validates, de-duplicates, and posts numeric updates', async () => {
  const source = await readExtensionSource();

  assert.match(source, /rowsInput\.addEventListener\('keydown'/);
  assert.match(source, /rowsInput\.addEventListener\('blur'/);
  assert.match(source, /rowsInput\.addEventListener\('input'/);
  assert.match(source, /const value = Number\(rawValue\);/);
  assert.match(source, /!Number\.isInteger\(value\) \|\| value < 0/);
  assert.match(source, /if \(nextValue === lastSubmittedMaxLines\) \{/);
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*?type: 'updateMaxLines',[\s\S]*?value[\s\S]*?\}\);/
  );
});

test('webview exposes all render modes and preserves virtual-scroll helpers', async () => {
  const source = await readExtensionSource();

  assert.match(source, /data-mode="pretty"/);
  assert.match(source, /data-mode="wrappedRaw"/);
  assert.match(source, /data-mode="rawLine"/);
  assert.match(source, /id="raw-contents"/);
  assert.match(source, /function renderLimitedVirtualViewer\(\) \{/);
  assert.match(source, /function renderFullViewer\(\) \{/);
  assert.match(source, /function requestVisibleRows\(\) \{/);
  assert.match(source, /function requestLimitedVisibleRows\(\) \{/);
  assert.match(
    source,
    /function renderVirtualRows\(start, entries, totalRows, rowMode\) \{/
  );
  assert.match(source, /function measureRenderedRows\(rowMode = mode\) \{/);
});
