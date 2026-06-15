import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import {
  DEFAULT_INDENT,
  DEFAULT_MAX_LINES,
  INDEXED_PREVIEW_LINE_THRESHOLD,
  countJsonlLines,
  fetchJsonlRows,
  formatJsonlLine,
  getDisplayRowCount,
  indexJsonlFile,
  isAbortError,
  normalizeViewerSettings,
  readJsonlPreview,
  shouldUseIndexedPreview
} from '../src/jsonl';

let tempDir = '';

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-jsonl-viewer-'));
});

after(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('default limit reads the first 20 lines only', async () => {
  const filePath = await writeFixture(
    'default-limit.jsonl',
    Array.from({ length: 25 }, (_, index) => JSON.stringify({ index })).join('\n')
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
    Array.from({ length: 5 }, (_, index) => JSON.stringify({ index })).join('\n')
  );
  const progress: Array<{ loadedLineCount: number; displayLimit: number; percent: number }> = [];

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
    Array.from({ length: 25 }, (_, index) => JSON.stringify({ index })).join('\n')
  );

  const preview = await readJsonlPreview(filePath, { maxLines: 0, indent: 2 });

  assert.equal(preview.loadedLineCount, 25);
  assert.equal(preview.entries.length, 25);
  assert.equal(preview.entries[24]?.lineNumber, 25);
  assert.match(preview.plainText, /"index":24/);
});

test('exact line count handles common newline shapes', async () => {
  const cases: Array<readonly [string, string, number]> = [
    ['empty.jsonl', '', 0],
    ['trailing-newline.jsonl', '{"a":1}\n', 1],
    ['no-trailing-newline.jsonl', '{"a":1}\n{"b":2}', 2],
    ['blank-line.jsonl', '\n', 1]
  ];

  for (const [fileName, contents, expected] of cases) {
    const filePath = await writeFixture(fileName, contents);
    assert.equal(await countJsonlLines(filePath), expected, fileName);
  }
});

test('exact line count reports byte and line progress', async () => {
  // Verifies progress is observable during full-file counts and that the
  // final event matches the returned count; the webview depends on this to
  // avoid looking frozen while it still auto-counts large files.
  const contents = '{"a":1}\n{"b":2}\n{"c":3}';
  const filePath = await writeFixture('count-progress.jsonl', contents);
  const progress: Array<{ bytesRead: number; totalBytes: number; percent: number; lineCount: number }> = [];

  const lineCount = await countJsonlLines(filePath, {
    chunkSize: 4,
    progressIntervalMs: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(lineCount, 3);
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.bytesRead, 0);
  assert.equal(progress[0]?.totalBytes, Buffer.byteLength(contents));
  assert.equal(progress[0]?.lineCount, 0);
  assert.equal(progress.at(-1)?.bytesRead, Buffer.byteLength(contents));
  assert.equal(progress.at(-1)?.percent, 100);
  assert.equal(progress.at(-1)?.lineCount, 3);
});

test('full-file indexing handles line offsets and stream chunk boundaries', async () => {
  const filePath = await writeFixture('chunk-boundary.jsonl', '{"a":1}\n{"b":2}\n{"c":3}');
  const index = await indexJsonlFile(filePath, { chunkSize: 3 });

  assert.equal(index.indexedLineCount, 3);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.equal(index.fileSize, Buffer.byteLength('{"a":1}\n{"b":2}\n{"c":3}'));
  assert.deepEqual(index.lineOffsets, [0, 8, 16]);
});

test('full-file indexing does not add a phantom line for trailing newline', async () => {
  const filePath = await writeFixture('trailing-index.jsonl', '{"a":1}\n{"b":2}\n');
  const index = await indexJsonlFile(filePath, { chunkSize: 4 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing stops after the requested line limit without fetching the rest of the file', async () => {
  const filePath = await writeFixture('prefix-limit.jsonl', '{"a":1}\n{"b":2}\n{"c":3}');
  const index = await indexJsonlFile(filePath, { chunkSize: 64, lineLimit: 2 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, Buffer.byteLength('{"a":1}\n{"b":2}\n'));
  assert.equal(index.isComplete, false);
  assert.deepEqual(index.lineOffsets, [0, 8]);

  const rows = await fetchJsonlRows(filePath, index, { start: 0, count: 2, indent: 2 });
  assert.equal(rows.indexedLineCount, 2);
  assert.equal(rows.entries.length, 2);
  assert.equal(rows.entries[0]?.raw, '{"a":1}');
  assert.equal(rows.entries[1]?.raw, '{"b":2}');
  assert.ok(rows.entries.every((entry) => entry.raw !== '{"c":3}'));
});

test('prefix indexing is complete when the line limit exceeds file length', async () => {
  const filePath = await writeFixture('prefix-complete.jsonl', '{"a":1}\n{"b":2}');
  const index = await indexJsonlFile(filePath, { chunkSize: 3, lineLimit: 10 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing does not add a phantom row when the limited prefix ends at a trailing newline', async () => {
  const filePath = await writeFixture('prefix-trailing-newline.jsonl', '{"a":1}\n{"b":2}\n');
  const index = await indexJsonlFile(filePath, { chunkSize: 64, lineLimit: 2 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing rejects invalid line limits instead of falling back to full indexing', async () => {
  const filePath = await writeFixture('invalid-prefix-limit.jsonl', '{"a":1}\n{"b":2}');

  await assert.rejects(
    indexJsonlFile(filePath, { lineLimit: -1 }),
    /lineLimit must be 0 or a positive whole number/
  );

  await assert.rejects(
    indexJsonlFile(filePath, { lineLimit: Number.NaN }),
    /lineLimit must be 0 or a positive whole number/
  );
});

test('full-file indexing reports progress', async () => {
  const filePath = await writeFixture('progress.jsonl', '{"a":1}\n{"b":2}\n{"c":3}');
  const progress: Array<{ bytesRead: number; totalBytes: number; percent: number; indexedLineCount: number }> = [];
  const index = await indexJsonlFile(filePath, {
    chunkSize: 4,
    progressIntervalMs: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(index.indexedLineCount, 3);
  assert.ok(progress.length >= 2);
  assert.equal(progress[0]?.bytesRead, 0);
  assert.equal(progress.at(-1)?.bytesRead, index.fileSize);
  assert.equal(progress.at(-1)?.percent, 100);
  assert.equal(progress.at(-1)?.indexedLineCount, 3);
});

test('range fetching returns formatted rows and invalid JSON rows', async () => {
  const filePath = await writeFixture('range.jsonl', '{"a":1}\nnot-json\n{"c":{"d":3}}\n');
  const index = await indexJsonlFile(filePath, { chunkSize: 5 });
  const rows = await fetchJsonlRows(filePath, index, { start: 1, count: 2, indent: 4 });

  assert.equal(rows.start, 1);
  assert.equal(rows.indexedLineCount, 3);
  assert.equal(rows.entries.length, 2);
  assert.equal(rows.entries[0]?.lineNumber, 2);
  assert.equal(rows.entries[0]?.kind, 'error');
  assert.equal(rows.entries[0]?.raw, 'not-json');
  assert.equal(rows.entries[1]?.lineNumber, 3);
  assert.equal(rows.entries[1]?.kind, 'json');

  if (rows.entries[1]?.kind === 'json') {
    assert.match(rows.entries[1].formatted, /\n {4}"c"/);
    assert.match(rows.entries[1].formatted, /\n {8}"d"/);
  }
});

test('range fetching clamps out-of-range requests', async () => {
  const filePath = await writeFixture('range-clamp.jsonl', '{"a":1}\n{"b":2}');
  const index = await indexJsonlFile(filePath);
  const rows = await fetchJsonlRows(filePath, index, { start: 10, count: 10, indent: 2 });

  assert.equal(rows.start, 2);
  assert.equal(rows.entries.length, 0);
  assert.equal(rows.indexedLineCount, 2);
});

test('full-file indexing can be cancelled', async () => {
  const filePath = await writeFixture(
    'cancel.jsonl',
    Array.from({ length: 100 }, (_, index) => JSON.stringify({ index })).join('\n')
  );
  const controller = new AbortController();

  await assert.rejects(
    indexJsonlFile(filePath, {
      chunkSize: 8,
      progressIntervalMs: 0,
      signal: controller.signal,
      onProgress: (event) => {
        if (event.bytesRead > 0) {
          controller.abort();
        }
      }
    }),
    (error: unknown) => isAbortError(error)
  );
});

test('line counting can be cancelled', async () => {
  const filePath = await writeFixture('cancel-count.jsonl', '{"a":1}\n{"b":2}');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    countJsonlLines(filePath, {
      signal: controller.signal
    }),
    (error: unknown) => isAbortError(error)
  );
});

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

test('settings validation falls back for invalid numbers', () => {
  assert.deepEqual(
    normalizeViewerSettings({
      maxLines: -1,
      indent: 0
    }),
    {
      maxLines: DEFAULT_MAX_LINES,
      indent: DEFAULT_INDENT
    }
  );

  assert.deepEqual(
    normalizeViewerSettings({
      maxLines: 0,
      indent: 4
    }),
    {
      maxLines: 0,
      indent: 4
    }
  );
});

test('large positive row counts use indexed preview and clamp to total lines', () => {
  assert.equal(shouldUseIndexedPreview(0), true);
  assert.equal(shouldUseIndexedPreview(DEFAULT_MAX_LINES), false);
  assert.equal(shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD - 1), false);
  assert.equal(shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD), true);
  assert.equal(shouldUseIndexedPreview(10_000_000), true);

  assert.equal(getDisplayRowCount(200_000, 0), 200_000);
  assert.equal(getDisplayRowCount(200_000, 1_000), 1_000);
  assert.equal(getDisplayRowCount(200_000, 10_000_000), 200_000);
});

async function writeFixture(fileName: string, contents: string): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}
