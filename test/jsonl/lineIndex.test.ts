import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAbortError } from '../../src/jsonl/errors';
import { fetchJsonlRows, indexJsonlFile } from '../../src/jsonl/lineIndex';
import { writeFixture } from '../support/jsonlFixtures';

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

test('full-file indexing accepts non-Buffer stream chunks', async () => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const originalCreateReadStream = nodeFs.createReadStream;
  const contents = '{"a":1}\n{"b":2}';
  const filePath = await writeFixture('index-array-buffer.jsonl', contents);
  const chunk = Uint8Array.from(Buffer.from(contents)).buffer;

  nodeFs.createReadStream = (() =>
    createAsyncStream([chunk])) as unknown as typeof nodeFs.createReadStream;
  try {
    const index = await indexJsonlFile(filePath);

    assert.equal(index.indexedLineCount, 2);
    assert.deepEqual(index.lineOffsets, [0, 8]);
  } finally {
    nodeFs.createReadStream = originalCreateReadStream;
  }
});

function createAsyncStream(
  chunks: readonly unknown[]
): AsyncIterable<unknown> & { destroy(): void } {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    destroy: () => undefined
  };
}
