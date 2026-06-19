import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatBytes,
  formatInteger,
  formatPercent
} from '../src/webview/lib/format';
import {
  findStringEnd,
  isObjectKey,
  readKeyword,
  readNumber,
  tokenizeJson
} from '../src/webview/lib/highlight';
import {
  EXTENSION_MESSAGE_TYPES,
  WEBVIEW_POSTED_MESSAGE_TYPES,
  getMaxLinesSubmission,
  normalizeLineCountProgress,
  withLineCountState
} from '../src/webview/lib/protocol';
import {
  MAX_MEASURED_ROW_HEIGHTS,
  MAX_VIRTUAL_SCROLL_HEIGHT,
  getEstimatedRowHeight,
  getIndexAtScrollOffset,
  getLogicalViewportBottom,
  getMeasuredRowHeight,
  getMeasuredRowHeightCount,
  getMeasuredRowHeightEntries,
  getVirtualOffset,
  getVirtualSpacerHeight,
  getVirtualTotalHeight,
  getVirtualWindow,
  getVisibleRowRange,
  logicalToPhysicalOffset,
  pruneMeasuredRowHeights,
  resetVirtualMeasurements,
  scrollToLogicalOffset,
  setMeasuredRowHeight,
  setVirtualScrollMode,
  setVirtualWindow
} from '../src/webview/lib/virtualScroll';

test('webview format helpers clamp and format values like the embedded viewer', () => {
  assert.equal(formatPercent(-1), '0.0%');
  assert.equal(formatPercent(12.345), '12.3%');
  assert.equal(formatPercent(101), '100.0%');

  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(-1), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(10 * 1024), '10.0 KB');

  assert.equal(formatInteger(Number.POSITIVE_INFINITY), 'Infinity');
  assert.equal(formatInteger(1234.8), '1,234');
});

test('webview max-lines validation rejects invalid input and de-duplicates submitted values', () => {
  assert.deepEqual(getMaxLinesSubmission('', ''), {
    kind: 'invalid',
    message: 'Rows must be 0 or a positive whole number.'
  });
  assert.equal(getMaxLinesSubmission('-1', '').kind, 'invalid');
  assert.equal(getMaxLinesSubmission('1.5', '').kind, 'invalid');
  assert.deepEqual(getMaxLinesSubmission('007', ''), {
    kind: 'changed',
    value: 7,
    submittedValue: '7'
  });
  assert.deepEqual(getMaxLinesSubmission('7', '7'), {
    kind: 'unchanged',
    value: 7
  });
});

test('webview line-count state helpers preserve progress and unavailable states', () => {
  assert.deepEqual(withLineCountState({ lineCount: null, value: 'x' }), {
    lineCount: null,
    value: 'x',
    lineCountState: 'counting',
    lineCountProgress: null
  });
  assert.deepEqual(withLineCountState({ lineCount: 3 }), {
    lineCount: 3,
    lineCountState: 'ready',
    lineCountProgress: null
  });
  assert.deepEqual(normalizeLineCountProgress({ percent: 25, lineCount: 10 }), {
    percent: 25,
    lineCount: 10
  });
  assert.deepEqual(normalizeLineCountProgress({ percent: 50 }), {
    percent: 50,
    lineCount: null
  });
  assert.equal(normalizeLineCountProgress({ percent: Number.NaN }), null);
  assert.equal(normalizeLineCountProgress(null), null);
});

test('webview protocol constants list expected extension and webview message types', () => {
  assert.deepEqual(EXTENSION_MESSAGE_TYPES, [
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
  ]);
  assert.deepEqual(WEBVIEW_POSTED_MESSAGE_TYPES, [
    'ready',
    'rawContents',
    'cancelIndex',
    'fetchRows',
    'updateMaxLines'
  ]);
});

test('webview JSON tokenizer classifies strings, keys, numbers, keywords, and punctuation', () => {
  const tokens = tokenizeJson(
    '{"a":"x","escaped":"a\\"b","n":-1.2e+3,"t":true,"f":false,"z":null}'
  );

  assert.ok(
    tokens.some(
      (token) => token.text === '"a"' && token.className === 'json-token key'
    )
  );
  assert.ok(
    tokens.some(
      (token) => token.text === '"x"' && token.className === 'json-token string'
    )
  );
  assert.ok(
    tokens.some(
      (token) =>
        token.text === '-1.2e+3' && token.className === 'json-token number'
    )
  );
  assert.ok(
    tokens.some(
      (token) =>
        token.text === 'true' && token.className === 'json-token boolean'
    )
  );
  assert.ok(
    tokens.some(
      (token) => token.text === 'null' && token.className === 'json-token null'
    )
  );
  assert.ok(
    tokens.some(
      (token) =>
        token.text === '{' && token.className === 'json-token punctuation'
    )
  );
});

test('webview JSON tokenizer respects string escapes and token boundaries', () => {
  assert.deepEqual(tokenizeJson('abc'), [
    { text: 'a', className: '' },
    { text: 'b', className: '' },
    { text: 'c', className: '' }
  ]);
  assert.equal(findStringEnd('"a\\"b"', 0), 6);
  assert.equal(findStringEnd('"unterminated', 0), 13);
  assert.equal(isObjectKey('"a" : 1', 3), true);
  assert.equal(isObjectKey('"a", 1', 3), false);
  assert.equal(readNumber('-12.5e-2 ', 0), '-12.5e-2');
  assert.equal(readNumber('12abc', 0), '');
  assert.equal(readKeyword('true ', 0, 'true'), true);
  assert.equal(readKeyword('trueValue', 0, 'true'), false);
});

test('webview virtual scroll helpers map logical rows onto capped physical scroll space', () => {
  const measured = new Map([[0, 50]]);

  assert.equal(getEstimatedRowHeight('pretty'), 180);
  assert.equal(getEstimatedRowHeight('wrappedRaw'), 82);
  assert.equal(getEstimatedRowHeight('rawLine'), 46);
  assert.equal(getVirtualTotalHeight(2, 'rawLine', measured), 96);
  assert.equal(
    getVirtualSpacerHeight(1_000_000, 'pretty', new Map()),
    MAX_VIRTUAL_SCROLL_HEIGHT
  );
  assert.equal(scrollToLogicalOffset(80, 1, 100, 'rawLine', new Map()), 46);

  const logicalHeight = getVirtualTotalHeight(1_000_000, 'pretty', new Map());
  const logical = scrollToLogicalOffset(
    MAX_VIRTUAL_SCROLL_HEIGHT,
    1_000_000,
    100,
    'pretty',
    new Map()
  );
  assert.ok(logical <= logicalHeight);
  assert.equal(getLogicalViewportBottom(40, 1, 100, 'rawLine', new Map()), 46);
  assert.equal(
    logicalToPhysicalOffset(100, 10, 100, 'rawLine', new Map()),
    100
  );
  assert.equal(getVirtualOffset(2, 'rawLine', measured), 96);
  assert.equal(getIndexAtScrollOffset(100, 10, 'rawLine', measured), 2);
  assert.deepEqual(getVisibleRowRange(0, 100, 46, 'rawLine', new Map()), {
    start: 0,
    end: 10,
    count: 10
  });
});

test('webview virtual scroll measurement pruning keeps the visible window bounded', () => {
  const measured = new Map<number, number>();
  for (let index = 0; index < 600; index += 1) {
    measured.set(index, 50);
  }

  pruneMeasuredRowHeights(measured, 300, 10);

  assert.ok(measured.size <= MAX_MEASURED_ROW_HEIGHTS);
  assert.equal(measured.has(0), false);
  assert.equal(measured.has(300), true);
});

test('webview virtual scroll state helpers reset mode, windows, and measurements', () => {
  resetVirtualMeasurements();
  setVirtualScrollMode('rawLine');
  assert.equal(getEstimatedRowHeight(), 46);

  setVirtualWindow(12, 34);
  assert.deepEqual(getVirtualWindow(), {
    start: 12,
    totalRows: 34
  });

  setMeasuredRowHeight(2, 60);
  assert.equal(getMeasuredRowHeight(2), 60);
  assert.equal(getMeasuredRowHeightCount(), 1);
  assert.deepEqual(getMeasuredRowHeightEntries(), [[2, 60]]);
  assert.equal(getVirtualTotalHeight(3), 152);

  resetVirtualMeasurements();
  assert.equal(getMeasuredRowHeightCount(), 0);
  assert.deepEqual(getVirtualWindow(), {
    start: 0,
    totalRows: 0
  });
  setVirtualScrollMode('pretty');
});

test('webview virtual scroll helpers cover empty rows, compression, and pruning fallbacks', () => {
  assert.equal(getIndexAtScrollOffset(0, 0, 'pretty', new Map()), 0);
  assert.equal(
    getVirtualTotalHeight(
      -1,
      'rawLine',
      new Map([
        [-1, 100],
        [2, 70]
      ])
    ),
    0
  );

  const compressed = logicalToPhysicalOffset(
    50_000_000,
    1_000_000,
    100,
    'pretty',
    new Map()
  );
  assert.ok(compressed > 0);
  assert.ok(compressed < 50_000_000);

  const small = new Map([[1, 50]]);
  pruneMeasuredRowHeights(small, 0, 1);
  assert.equal(small.size, 1);

  const large = new Map<number, number>();
  for (let index = 0; index < 1000; index += 1) {
    large.set(index, 50);
  }
  pruneMeasuredRowHeights(large, 500, 1000);
  assert.ok(large.size <= MAX_MEASURED_ROW_HEIGHTS);
  assert.equal(large.has(0), false);

  resetVirtualMeasurements();
  for (let index = 0; index < 600; index += 1) {
    setMeasuredRowHeight(index, 50);
  }
  pruneMeasuredRowHeights(300, 10);
  assert.ok(getMeasuredRowHeightCount() <= MAX_MEASURED_ROW_HEIGHTS);
  resetVirtualMeasurements();
});
