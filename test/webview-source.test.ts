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

test('rows input rejects empty values before posting maxLines updates', async () => {
  const source = await readExtensionSource();

  assert.match(source, /const rawValue = rowsInput\.value\.trim\(\);/);
  assert.match(source, /if \(rawValue === ''\) \{[\s\S]*?showRowsError\('Rows must be 0 or a positive whole number\.'\);[\s\S]*?return;/);
  assert.match(source, /const value = Number\(rawValue\);/);
});

test('rows input hides native number spinner controls', async () => {
  const source = await readExtensionSource();

  assert.match(source, /\.rows-input \{[\s\S]*?appearance: textfield;[\s\S]*?-moz-appearance: textfield;/);
  assert.match(source, /\.rows-input::-webkit-inner-spin-button,\s*\.rows-input::-webkit-outer-spin-button \{[\s\S]*?-webkit-appearance: none;/);
});

test('line count errors persist through webview rerenders', async () => {
  const source = await readExtensionSource();

  // Verifies line-count failures are stored in webview state, not only in the
  // DOM, because mode changes rerender the info bar from that state.
  assert.match(source, /function withLineCountState\(payload\) \{[\s\S]*?lineCountState: payload\.lineCount === null \? 'counting' : 'ready'/);
  assert.match(source, /if \(message\.type === 'lineCountError'\) \{[\s\S]*?data\.lineCountState = 'unavailable';[\s\S]*?renderLimitedInfo\(\);/);
  assert.match(source, /if \(message\.type === 'lineCountError'\) \{[\s\S]*?full\.lineCountState = 'unavailable';[\s\S]*?renderFullInfo\(\);/);
  assert.match(source, /function setLineCountText\(state, value\) \{[\s\S]*?state === 'unavailable'[\s\S]*?lineCount\.textContent = 'Unavailable';/);
});

test('virtual scrolling uses capped physical spacer and logical offsets', async () => {
  const source = await readExtensionSource();

  // Verifies huge logical row ranges are mapped onto a capped physical
  // scrollbar, because Chromium webviews can clamp very tall elements.
  assert.match(source, /const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;/);
  assert.match(source, /function getVirtualSpacerHeight\(totalRows, rowMode = mode\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows, rowMode\), MAX_VIRTUAL_SCROLL_HEIGHT\)/);
  assert.match(source, /function scrollToLogicalOffset\(scrollOffset, totalRows, viewportHeight, rowMode = mode\)/);
  assert.match(source, /function getLogicalViewportBottom\(logicalScrollTop, totalRows, viewportHeight, rowMode = mode\)/);
  assert.match(source, /function logicalToPhysicalOffset\(logicalOffset, totalRows, viewportHeight, rowMode = mode\)/);
  assert.match(source, /getIndexAtScrollOffset\(logicalScrollTop, full\.totalRows\)/);
  // Locks bottom-edge lookup to the helper; otherwise bottom-of-file requests
  // can stop at the scroll-top maximum and omit final visible rows.
  assert.match(source, /const logicalScrollBottom = getLogicalViewportBottom\(\s*logicalScrollTop,\s*full\.totalRows,\s*virtualScroll\.clientHeight\s*\);/);
  assert.match(source, /const logicalScrollBottom = getLogicalViewportBottom\(\s*logicalScrollTop,\s*totalRows,\s*virtualScroll\.clientHeight\s*\);/);
  assert.match(source, /logicalToPhysicalOffset\(getVirtualOffset\(start, rowMode\), totalRows, virtualScroll\.clientHeight, rowMode\)/);
});

test('virtual scrolling maps viewport bottom to full logical height', async () => {
  const source = await readExtensionSource();

  // Verifies the bottom edge clamps to the content height, not the scroll-top
  // maximum, so bottom-of-file requests include the final visible rows.
  assert.match(source, /function getLogicalViewportBottom\(logicalScrollTop, totalRows, viewportHeight, rowMode = mode\) \{[\s\S]*?Math\.min\(getVirtualTotalHeight\(totalRows, rowMode\), logicalScrollTop \+ viewportHeight\)/);
});

test('virtual scrolling keeps non-scrollable offsets inside logical height', async () => {
  const source = await readExtensionSource();

  // Verifies a zero scroll range does not collapse every offset to the top.
  assert.match(source, /if \(logicalMax === 0 \|\| physicalMax === 0\) \{\s*return Math\.max\(0, Math\.min\(logicalHeight, scrollOffset\)\);\s*\}/);
});
