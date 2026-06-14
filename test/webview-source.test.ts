import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';

async function readExtensionSource(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), 'src', 'extension.ts'), 'utf8');
}

test('webview top bar labels use colons, separators, and Show rows wording', async () => {
  const source = await readExtensionSource();

  assert.match(source, /<strong>Size:<\/strong>/);
  assert.match(source, /<strong>Total lines:<\/strong>/);
  assert.match(source, /<strong>Show<\/strong>[\s\S]*<span>rows<\/span>/);
  assert.match(source, /<strong>Modified:<\/strong>/);
  assert.match(source, /\.info-item:not\(:first-child\)::before[\s\S]*content: "\|";/);
});

test('raw-line virtual rows stay unwrapped without fixed-height clipping', async () => {
  const source = await readExtensionSource();

  assert.match(source, /\.entry\.raw-line pre[\s\S]*white-space: pre;/);
  assert.match(source, /\.virtual-row\.raw-line \.line-body[\s\S]*overflow-x: auto;/);
  assert.doesNotMatch(source, /\.virtual-row\.raw-line\s*\{[\s\S]*?height:/);
  assert.doesNotMatch(source, /\.virtual-row\.raw-line \.line-body\s*\{[\s\S]*?overflow-y: hidden;/);
});
