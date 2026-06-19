import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import {
  DEFAULT_INDENT,
  DEFAULT_MAX_LINES,
  INDEXED_PREVIEW_LINE_THRESHOLD,
  JsonlOperationCancelledError,
  countJsonlLines,
  fetchJsonlRows,
  formatFileSize,
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
  const progress: Array<{
    bytesRead: number;
    totalBytes: number;
    percent: number;
    lineCount: number;
  }> = [];

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
  const filePath = await writeFixture(
    'chunk-boundary.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 3 });

  assert.equal(index.indexedLineCount, 3);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.equal(index.fileSize, Buffer.byteLength('{"a":1}\n{"b":2}\n{"c":3}'));
  assert.deepEqual(index.lineOffsets, [0, 8, 16]);
});

test('full-file indexing does not add a phantom line for trailing newline', async () => {
  const filePath = await writeFixture(
    'trailing-index.jsonl',
    '{"a":1}\n{"b":2}\n'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 4 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing stops after the requested line limit without fetching the rest of the file', async () => {
  const filePath = await writeFixture(
    'prefix-limit.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 64, lineLimit: 2 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, Buffer.byteLength('{"a":1}\n{"b":2}\n'));
  assert.equal(index.isComplete, false);
  assert.deepEqual(index.lineOffsets, [0, 8]);

  const rows = await fetchJsonlRows(filePath, index, {
    start: 0,
    count: 2,
    indent: 2
  });
  assert.equal(rows.indexedLineCount, 2);
  assert.equal(rows.entries.length, 2);
  assert.equal(rows.entries[0]?.raw, '{"a":1}');
  assert.equal(rows.entries[1]?.raw, '{"b":2}');
  assert.ok(rows.entries.every((entry) => entry.raw !== '{"c":3}'));
});

test('prefix indexing is complete when the line limit exceeds file length', async () => {
  const filePath = await writeFixture(
    'prefix-complete.jsonl',
    '{"a":1}\n{"b":2}'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 3, lineLimit: 10 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing does not add a phantom row when the limited prefix ends at a trailing newline', async () => {
  const filePath = await writeFixture(
    'prefix-trailing-newline.jsonl',
    '{"a":1}\n{"b":2}\n'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 64, lineLimit: 2 });

  assert.equal(index.indexedLineCount, 2);
  assert.equal(index.indexedEndOffset, index.fileSize);
  assert.equal(index.isComplete, true);
  assert.deepEqual(index.lineOffsets, [0, 8]);
});

test('prefix indexing rejects invalid line limits instead of falling back to full indexing', async () => {
  const filePath = await writeFixture(
    'invalid-prefix-limit.jsonl',
    '{"a":1}\n{"b":2}'
  );

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
  const filePath = await writeFixture(
    'progress.jsonl',
    '{"a":1}\n{"b":2}\n{"c":3}'
  );
  const progress: Array<{
    bytesRead: number;
    totalBytes: number;
    percent: number;
    indexedLineCount: number;
  }> = [];
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
  const filePath = await writeFixture(
    'range.jsonl',
    '{"a":1}\nnot-json\n{"c":{"d":3}}\n'
  );
  const index = await indexJsonlFile(filePath, { chunkSize: 5 });
  const rows = await fetchJsonlRows(filePath, index, {
    start: 1,
    count: 2,
    indent: 4
  });

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
  const rows = await fetchJsonlRows(filePath, index, {
    start: 10,
    count: 10,
    indent: 2
  });

  assert.equal(rows.start, 2);
  assert.equal(rows.entries.length, 0);
  assert.equal(rows.indexedLineCount, 2);
});

test('full-file indexing can be cancelled', async () => {
  const filePath = await writeFixture(
    'cancel.jsonl',
    Array.from({ length: 100 }, (_, index) => JSON.stringify({ index })).join(
      '\n'
    )
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
  assert.equal(
    shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD - 1),
    false
  );
  assert.equal(shouldUseIndexedPreview(INDEXED_PREVIEW_LINE_THRESHOLD), true);
  assert.equal(shouldUseIndexedPreview(10_000_000), true);

  assert.equal(getDisplayRowCount(200_000, 0), 200_000);
  assert.equal(getDisplayRowCount(200_000, 1_000), 1_000);
  assert.equal(getDisplayRowCount(200_000, 10_000_000), 200_000);
});

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

test('lineLimit 0 returns an intentionally empty incomplete index', async () => {
  const filePath = await writeFixture('zero-limit.jsonl', '{"a":1}\n{"b":2}');
  const progress: Array<{ bytesRead: number; indexedLineCount: number }> = [];

  const index = await indexJsonlFile(filePath, {
    lineLimit: 0,
    onProgress: (event) => progress.push(event)
  });

  assert.equal(index.fileSize, Buffer.byteLength('{"a":1}\n{"b":2}'));
  assert.deepEqual(index.lineOffsets, []);
  assert.equal(index.indexedLineCount, 0);
  assert.equal(index.indexedEndOffset, 0);
  assert.equal(index.isComplete, false);
  assert.deepEqual(progress, [
    {
      bytesRead: 0,
      totalBytes: index.fileSize,
      percent: 0,
      indexedLineCount: 0
    }
  ]);
});

test('range fetching strips CRLF carriage returns', async () => {
  const filePath = await writeFixture('crlf.jsonl', '{"a":1}\r\n{"b":2}\r\n');
  const index = await indexJsonlFile(filePath, { chunkSize: 4 });

  const rows = await fetchJsonlRows(filePath, index, {
    start: 0,
    count: 2,
    indent: 2
  });

  assert.equal(rows.entries.length, 2);
  assert.equal(rows.entries[0]?.raw, '{"a":1}');
  assert.equal(rows.entries[1]?.raw, '{"b":2}');
});

test('indexing and fetching preserve multibyte UTF-8 line offsets', async () => {
  const first = JSON.stringify({ text: 'é', index: 1 });
  const second = JSON.stringify({ text: '東京', index: 2 });
  const contents = `${first}\n${second}`;
  const filePath = await writeFixture('unicode.jsonl', contents);

  const index = await indexJsonlFile(filePath, { chunkSize: 5 });
  const rows = await fetchJsonlRows(filePath, index, {
    start: 1,
    count: 1,
    indent: 2
  });

  assert.deepEqual(index.lineOffsets, [0, Buffer.byteLength(`${first}\n`)]);
  assert.equal(index.fileSize, Buffer.byteLength(contents));
  assert.equal(rows.entries[0]?.raw, second);
});

test('fetchJsonlRows clamps unusual ranges and handles empty byte ranges', async () => {
  const filePath = await writeFixture('range-edges.jsonl', '{"a":1}\n{"b":2}');
  const index = await indexJsonlFile(filePath);

  assert.equal(
    (
      await fetchJsonlRows(filePath, index, {
        start: 0,
        count: 0,
        indent: 2
      })
    ).entries.length,
    0
  );
  assert.equal(
    (
      await fetchJsonlRows(filePath, index, {
        start: -10,
        count: -1,
        indent: 2
      })
    ).entries.length,
    0
  );
  assert.equal(
    (
      await fetchJsonlRows(filePath, index, {
        start: Number.NaN,
        count: Number.NaN,
        indent: 2
      })
    ).entries.length,
    0
  );

  const fractional = await fetchJsonlRows(filePath, index, {
    start: 0.9,
    count: 1.9,
    indent: 2
  });
  assert.equal(fractional.start, 0);
  assert.equal(fractional.entries.length, 1);
  assert.equal(fractional.entries[0]?.raw, '{"a":1}');

  const malformed = await fetchJsonlRows(
    filePath,
    {
      fileSize: 10,
      lineOffsets: [8],
      indexedLineCount: 1,
      indexedEndOffset: 4,
      isComplete: false
    },
    {
      start: 0,
      count: 1,
      indent: 2
    }
  );
  assert.deepEqual(malformed.entries, []);
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

async function writeFixture(
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}
