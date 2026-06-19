import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  JsonlOperationCancelledError,
  countJsonlLines,
  fetchJsonlRows,
  formatFileSize,
  indexJsonlFile,
  isAbortError,
  readJsonlPreview
} from '../src/jsonl';
import { tempDir, writeFixture } from './support/jsonlFixtures';

test('empty files produce empty previews, counts, and indexes', async () => {
  const filePath = await writeFixture('empty-paths.jsonl', '');
  const countProgress: Array<{ percent: number; lineCount: number }> = [];
  const indexProgress: Array<{
    percent: number;
    indexedLineCount: number;
  }> = [];

  const preview = await readJsonlPreview(filePath, {
    maxLines: 20,
    indent: 2
  });
  const lineCount = await countJsonlLines(filePath, {
    onProgress: (event) => countProgress.push(event)
  });
  const index = await indexJsonlFile(filePath, {
    onProgress: (event) => indexProgress.push(event)
  });

  assert.deepEqual(preview, {
    entries: [],
    plainText: '',
    loadedLineCount: 0,
    displayLimit: 20
  });
  assert.equal(lineCount, 0);
  assert.deepEqual(index, {
    fileSize: 0,
    lineOffsets: [],
    indexedLineCount: 0,
    indexedEndOffset: 0,
    isComplete: true
  });
  assert.equal(countProgress.at(-1)?.percent, 100);
  assert.equal(countProgress.at(-1)?.lineCount, 0);
  assert.equal(indexProgress.at(-1)?.percent, 100);
  assert.equal(indexProgress.at(-1)?.indexedLineCount, 0);
});

test('helpers classify abort errors and format file sizes', () => {
  assert.equal(isAbortError(new JsonlOperationCancelledError()), true);
  assert.equal(
    isAbortError(
      Object.assign(new Error('native abort'), { name: 'AbortError' })
    ),
    true
  );
  assert.equal(isAbortError(new Error('not abort')), false);
  assert.equal(isAbortError('AbortError'), false);

  assert.equal(formatFileSize(Number.NaN), '0 B');
  assert.equal(formatFileSize(-1), '0 B');
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(999), '999 B');
  assert.equal(formatFileSize(1024), '1.00 KB');
  assert.equal(formatFileSize(10 * 1024), '10.0 KB');
  assert.equal(formatFileSize(1024 ** 2), '1.00 MB');
  assert.equal(formatFileSize(1024 ** 5), '1024.0 TB');
});

test('missing files reject from preview, count, index, and row fetch paths', async () => {
  const missingPath = path.join(tempDir, 'missing.jsonl');

  await assert.rejects(
    readJsonlPreview(missingPath, { maxLines: 1, indent: 2 }),
    /ENOENT/
  );
  await assert.rejects(countJsonlLines(missingPath), /ENOENT/);
  await assert.rejects(indexJsonlFile(missingPath), /ENOENT/);
  await assert.rejects(
    fetchJsonlRows(
      missingPath,
      {
        fileSize: 1,
        lineOffsets: [0],
        indexedLineCount: 1,
        indexedEndOffset: 1,
        isComplete: true
      },
      {
        start: 0,
        count: 1,
        indent: 2
      }
    ),
    /ENOENT/
  );
});

test('progress callbacks can be omitted or throttled while final events are forced', async () => {
  const filePath = await writeFixture(
    'throttled-progress.jsonl',
    '{"a":1}\n{"b":2}'
  );
  const previewProgress: Array<{ loadedLineCount: number; percent: number }> =
    [];
  const countProgress: Array<{ bytesRead: number; percent: number }> = [];
  const indexProgress: Array<{ bytesRead: number; percent: number }> = [];

  await readJsonlPreview(filePath, { maxLines: 2, indent: 2 });
  await countJsonlLines(filePath);
  await indexJsonlFile(filePath);

  await readJsonlPreview(
    filePath,
    { maxLines: 2, indent: 2 },
    {
      progressIntervalMs: 60_000,
      onProgress: (event) => previewProgress.push(event)
    }
  );
  await countJsonlLines(filePath, {
    progressIntervalMs: 60_000,
    onProgress: (event) => countProgress.push(event)
  });
  await indexJsonlFile(filePath, {
    progressIntervalMs: 60_000,
    onProgress: (event) => indexProgress.push(event)
  });

  assert.deepEqual(
    previewProgress.map((event) => event.loadedLineCount),
    [0, 2]
  );
  assert.equal(previewProgress.at(-1)?.percent, 100);
  assert.equal(countProgress[0]?.bytesRead, 0);
  assert.equal(countProgress.at(-1)?.percent, 100);
  assert.equal(indexProgress[0]?.bytesRead, 0);
  assert.equal(indexProgress.at(-1)?.percent, 100);
});
