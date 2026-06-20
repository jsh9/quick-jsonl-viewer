import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTENSION_MESSAGE_TYPES,
  WEBVIEW_POSTED_MESSAGE_TYPES,
  getMaxLinesSubmission,
  normalizeLineCountProgress,
  withLineCountState
} from '../../../src/webview/lib/protocol';

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
  let lineCountReads = 0;
  assert.deepEqual(
    normalizeLineCountProgress({
      percent: 75,
      get lineCount(): number | undefined {
        lineCountReads += 1;
        return lineCountReads === 1 ? 0 : undefined;
      }
    }),
    {
      percent: 75,
      lineCount: null
    }
  );
  assert.equal(normalizeLineCountProgress({ percent: Number.NaN }), null);
  assert.equal(normalizeLineCountProgress(null), null);
});

test('webview max-lines submission uses the defensive fallback message', () => {
  const originalString = globalThis.String;

  globalThis.String = ((value?: unknown): string => {
    if (value === 7) {
      return undefined as unknown as string;
    }

    return originalString(value);
  }) as StringConstructor;
  try {
    assert.deepEqual(getMaxLinesSubmission('7', ''), {
      kind: 'invalid',
      message: 'Rows must be 0 or a positive whole number.'
    });
  } finally {
    globalThis.String = originalString;
  }
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
