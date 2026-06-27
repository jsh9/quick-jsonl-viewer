import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_AUTO_REFRESH,
  DEFAULT_INDENT,
  DEFAULT_INDENT_GUIDES,
  DEFAULT_MAX_LINES,
  INDEXED_PREVIEW_LINE_THRESHOLD,
  getDisplayRowCount,
  normalizeViewerSettings,
  shouldUseIndexedPreview
} from '../../src/jsonl/settings';

test('settings validation falls back for invalid numbers', () => {
  // Start line is intentionally absent here; it is editor-local state, so
  // global settings normalization must not accept or persist it.
  assert.deepEqual(
    normalizeViewerSettings({
      maxLines: -1,
      indent: 0,
      autoRefresh: 'no',
      indentGuides: 'no'
    }),
    {
      maxLines: DEFAULT_MAX_LINES,
      indent: DEFAULT_INDENT,
      autoRefresh: DEFAULT_AUTO_REFRESH,
      indentGuides: DEFAULT_INDENT_GUIDES
    }
  );

  assert.deepEqual(
    normalizeViewerSettings({
      maxLines: 0,
      indent: 4,
      autoRefresh: false,
      indentGuides: false
    }),
    {
      maxLines: 0,
      indent: 4,
      autoRefresh: false,
      indentGuides: false
    }
  );
});

test('large positive row counts use indexed preview and clamp to total lines', () => {
  assert.equal(shouldUseIndexedPreview(0), true);
  assert.equal(shouldUseIndexedPreview(DEFAULT_MAX_LINES), false);
  assert.equal(
    shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD - 1),
    false
  );
  assert.equal(shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD), true);
  assert.equal(shouldUseIndexedPreview(10_000_000), true);

  assert.equal(getDisplayRowCount(200_000, 0), 200_000);
  assert.equal(getDisplayRowCount(200_000, 1_000), 1_000);
  assert.equal(getDisplayRowCount(200_000, 10_000_000), 200_000);
  assert.equal(getDisplayRowCount(200_000, 0, 100_001), 100_000);
  assert.equal(getDisplayRowCount(200_000, 1_000, 199_501), 500);
  assert.equal(getDisplayRowCount(200_000, 1_000, 200_001), 0);
});
