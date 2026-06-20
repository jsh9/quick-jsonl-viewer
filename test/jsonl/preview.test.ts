import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJsonlPreview } from '../../src/jsonl/preview';
import {
  DEFAULT_MAX_LINES,
  normalizeViewerSettings
} from '../../src/jsonl/settings';
import { writeFixture } from '../support/jsonlFixtures';

test('default limit reads the first 20 lines only', async () => {
  const filePath = await writeFixture(
    'default-limit.jsonl',
    Array.from({ length: 25 }, (_, index) => JSON.stringify({ index })).join(
      '\n'
    )
  );

  const settings = normalizeViewerSettings({});
  const preview = await readJsonlPreview(filePath, settings);

  assert.equal(settings.maxLines, DEFAULT_MAX_LINES);
  assert.equal(preview.loadedLineCount, 20);
  assert.equal(preview.entries.length, 20);
  assert.equal(preview.entries[0]?.lineNumber, 1);
  assert.equal(preview.entries[19]?.lineNumber, 20);
  assert.match(preview.plainText, /"index":19/);
  assert.doesNotMatch(preview.plainText, /"index":20/);
});

test('preview reading reports progress for limited loads', async () => {
  const filePath = await writeFixture(
    'preview-progress.jsonl',
    Array.from({ length: 5 }, (_, index) => JSON.stringify({ index })).join(
      '\n'
    )
  );
  const progress: Array<{
    loadedLineCount: number;
    displayLimit: number;
    percent: number;
  }> = [];

  const preview = await readJsonlPreview(
    filePath,
    { maxLines: 3, indent: 2 },
    {
      progressIntervalMs: 0,
      onProgress: (event) => progress.push(event)
    }
  );

  assert.equal(preview.loadedLineCount, 3);
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.loadedLineCount, 0);
  assert.equal(progress.at(-1)?.loadedLineCount, 3);
  assert.equal(progress.at(-1)?.displayLimit, 3);
  assert.equal(progress.at(-1)?.percent, 100);
});

test('maxLines set to 0 can still read all lines through the preview helper', async () => {
  const filePath = await writeFixture(
    'all-lines.jsonl',
    Array.from({ length: 25 }, (_, index) => JSON.stringify({ index })).join(
      '\n'
    )
  );
  const progress: Array<{ percent: number }> = [];

  const preview = await readJsonlPreview(
    filePath,
    { maxLines: 0, indent: 2 },
    {
      progressIntervalMs: 0,
      onProgress: (event) => progress.push(event)
    }
  );

  assert.equal(preview.loadedLineCount, 25);
  assert.equal(preview.entries.length, 25);
  assert.equal(preview.entries[24]?.lineNumber, 25);
  assert.match(preview.plainText, /"index":24/);
  assert.ok(progress.length >= 2);
  assert.equal(progress.at(-1)?.percent, 0);
});
