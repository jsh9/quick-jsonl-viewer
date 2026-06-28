import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COLLAPSED_PREVIEW_MAX_LENGTH,
  countLines,
  getCollapsedPreview,
  getHiddenLineCountText
} from '../../../src/webview/lib/collapse';

test('webview collapse helpers compact and truncate row previews', () => {
  assert.equal(getCollapsedPreview('  {"a": 1}\n  '), '{"a": 1}');
  assert.equal(getCollapsedPreview('a\nb\tc'), 'a b c');
  assert.equal(getCollapsedPreview('abcdef', 3), 'abc ...');
  assert.equal(getCollapsedPreview('abcdef', 0), ' ...');
  assert.equal(COLLAPSED_PREVIEW_MAX_LENGTH, 220);
});

test('webview collapse helpers describe hidden pretty-print lines', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('{"a":1}'), 1);
  assert.equal(countLines('{\n  "a": 1\n}'), 3);
  assert.equal(getHiddenLineCountText('{"a":1}'), '1 line hidden');
  assert.equal(getHiddenLineCountText('{\n  "a": 1\n}'), '3 lines hidden');
});
