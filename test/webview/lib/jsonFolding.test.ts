import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COLLAPSED_JSON_STRING_VALUE_PREVIEW_LENGTH,
  LONG_JSON_STRING_VALUE_THRESHOLD,
  getCollapsedJsonLine,
  getJsonFoldKey,
  getJsonFoldRanges,
  getJsonValueFoldKey,
  getLongJsonStringValueLine
} from '../../../src/webview/lib/jsonFolding';

test('webview JSON folding helpers find multi-line object and array ranges', () => {
  const formatted = JSON.stringify(
    {
      text: 'braces inside strings do not fold: {[]} ',
      empty: {},
      obj: {
        a: 1,
        list: [1, 2]
      },
      records: [{ ok: true }]
    },
    null,
    2
  );
  const lines = formatted.split('\n');
  const ranges = getJsonFoldRanges(formatted);
  const rangeByLine = new Map(ranges.map((range) => [range.startLine, range]));

  assert.equal(rangeByLine.get(0)?.endLine, lines.length - 1);
  assert.equal(rangeByLine.get(2), undefined);

  const objLine = lines.findIndex((line) => line.includes('"obj": {'));
  const listLine = lines.findIndex((line) => line.includes('"list": ['));
  const recordsLine = lines.findIndex((line) => line.includes('"records": ['));

  assert.ok(rangeByLine.get(objLine));
  assert.ok(rangeByLine.get(listLine));
  assert.ok(rangeByLine.get(recordsLine));
  assert.equal(rangeByLine.get(listLine)?.closeChar, ']');
});

test('webview JSON folding helpers build compact folded lines and stable keys', () => {
  const formatted = '{\n  "items": [\n    1,\n    2\n  ],\n  "ok": true\n}';
  const lines = formatted.split('\n');
  const ranges = getJsonFoldRanges(formatted);
  const arrayRange = ranges.find((range) => range.startLine === 1);
  const rootRange = ranges.find((range) => range.startLine === 0);

  assert.ok(arrayRange);
  assert.ok(rootRange);
  assert.equal(getCollapsedJsonLine(lines, arrayRange), '  "items": [ ... ],');
  assert.equal(getCollapsedJsonLine(lines, rootRange), '{ ... }');
  assert.equal(getJsonFoldKey(42, 3), '42:3');
  assert.equal(getJsonValueFoldKey(42, 3), '42:value:3');
});

test('webview JSON folding helpers collapse long string values', () => {
  const value =
    'prefix ' +
    'x'.repeat(
      LONG_JSON_STRING_VALUE_THRESHOLD +
        COLLAPSED_JSON_STRING_VALUE_PREVIEW_LENGTH
    );
  const folded = getLongJsonStringValueLine(
    '  "message": ' + JSON.stringify(value) + ','
  );

  assert.ok(folded);
  assert.equal(folded.valueLength, value.length);
  assert.match(folded.collapsedLine, /^  "message": "prefix x+/);
  assert.match(folded.collapsedLine, /\.\.\. \(\d+ chars hidden\)",$/);
});

test('webview JSON folding helpers skip short strings and non-value lines', () => {
  assert.equal(
    getLongJsonStringValueLine(
      '  "message": ' + JSON.stringify('x'.repeat(512))
    ),
    null
  );
  assert.equal(getLongJsonStringValueLine('  "not a complete value": '), null);
  assert.equal(
    getLongJsonStringValueLine(
      '  ' + JSON.stringify('array string ' + 'x'.repeat(513))
    )?.valueLength,
    526
  );
});
