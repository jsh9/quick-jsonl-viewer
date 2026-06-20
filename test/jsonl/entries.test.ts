import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatJsonlLine } from '../../src/jsonl/entries';

test('invalid JSON lines are represented as error entries without throwing', () => {
  const entry = formatJsonlLine(3, 'not-json', 2);

  assert.equal(entry.kind, 'error');
  assert.equal(entry.lineNumber, 3);
  assert.equal(entry.raw, 'not-json');
  assert.match(entry.error, /Unexpected token|not valid JSON/i);
});

test('valid JSON lines are formatted with the configured indentation', () => {
  const entry = formatJsonlLine(1, '{"a":{"b":1}}', 4);

  assert.equal(entry.kind, 'json');
  assert.match(entry.formatted, /\n {4}"a"/);
  assert.match(entry.formatted, /\n {8}"b"/);
});

test('invalid JSON lines stringify non-Error parse failures', () => {
  const originalParse = JSON.parse;

  JSON.parse = (() => {
    throw 'parse failed';
  }) as typeof JSON.parse;
  try {
    const entry = formatJsonlLine(1, '{"a":1}', 2);

    assert.equal(entry.kind, 'error');
    assert.equal(entry.error, 'parse failed');
  } finally {
    JSON.parse = originalParse;
  }
});
