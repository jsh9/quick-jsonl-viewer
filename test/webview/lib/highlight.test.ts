import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findStringEnd,
  isObjectKey,
  readKeyword,
  readNumber,
  tokenizeJson
} from '../../../src/webview/lib/highlight';

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
