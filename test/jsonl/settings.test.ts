import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_AUTO_REFRESH,
  DEFAULT_INDENT,
  DEFAULT_INDENT_GUIDES,
  DEFAULT_MAX_RENDERED_ROW_BYTES,
  DEFAULT_MAX_LINES,
  DEFAULT_OVERSIZED_ROW_PREVIEW_BYTES,
  INDEXED_PREVIEW_LINE_THRESHOLD,
  getDisplayRowCount,
  normalizeViewerSettings,
  shouldUseIndexedLoad,
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
      indentGuides: 'no',
      maxRenderedRowBytes: 0,
      oversizedRowPreviewBytes: -1
    }),
    {
      maxLines: DEFAULT_MAX_LINES,
      indent: DEFAULT_INDENT,
      autoRefresh: DEFAULT_AUTO_REFRESH,
      indentGuides: DEFAULT_INDENT_GUIDES,
      maxRenderedRowBytes: DEFAULT_MAX_RENDERED_ROW_BYTES,
      oversizedRowPreviewBytes: DEFAULT_OVERSIZED_ROW_PREVIEW_BYTES
    }
  );

  assert.deepEqual(
    normalizeViewerSettings({
      maxLines: 0,
      indent: 4,
      autoRefresh: false,
      indentGuides: false,
      maxRenderedRowBytes: 512,
      oversizedRowPreviewBytes: 0
    }),
    {
      maxLines: 0,
      indent: 4,
      autoRefresh: false,
      indentGuides: false,
      maxRenderedRowBytes: 512,
      oversizedRowPreviewBytes: 0
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
  // The load helper also indexes distant Start at line jumps; this avoids
  // silently scanning a long prefix in the lightweight preview path.
  assert.equal(shouldUseIndexedLoad(DEFAULT_MAX_LINES, 1), false);
  assert.equal(shouldUseIndexedLoad(DEFAULT_MAX_LINES, 200), false);
  assert.equal(shouldUseIndexedLoad(DEFAULT_MAX_LINES, 201), true);
  assert.equal(shouldUseIndexedLoad(0, 1), true);

  assert.equal(getDisplayRowCount(200_000, 0), 200_000);
  assert.equal(getDisplayRowCount(200_000, 1_000), 1_000);
  assert.equal(getDisplayRowCount(200_000, 10_000_000), 200_000);
  assert.equal(getDisplayRowCount(200_000, 0, 100_001), 100_000);
  assert.equal(getDisplayRowCount(200_000, 1_000, 199_501), 500);
  assert.equal(getDisplayRowCount(200_000, 1_000, 200_001), 0);
});
