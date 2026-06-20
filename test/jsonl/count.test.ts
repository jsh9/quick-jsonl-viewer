import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { countJsonlLines } from '../../src/jsonl/count';
import { isAbortError } from '../../src/jsonl/errors';
import { writeFixture } from '../support/jsonlFixtures';

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

test('line counting accepts non-Buffer stream chunks', async () => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const originalCreateReadStream = nodeFs.createReadStream;
  const contents = '{"a":1}\n';
  const filePath = await writeFixture('count-array-buffer.jsonl', contents);
  const chunk = Uint8Array.from(Buffer.from(contents)).buffer;

  nodeFs.createReadStream = (() =>
    createAsyncStream([chunk])) as unknown as typeof nodeFs.createReadStream;
  try {
    assert.equal(await countJsonlLines(filePath), 1);
  } finally {
    nodeFs.createReadStream = originalCreateReadStream;
  }
});

test('line counting tolerates a missing final byte from converted chunks', async () => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const originalCreateReadStream = nodeFs.createReadStream;
  const originalBufferFrom = Buffer.from;
  const marker = new ArrayBuffer(1);
  const filePath = await writeFixture('count-missing-final-byte.jsonl', 'x');

  nodeFs.createReadStream = (() =>
    createAsyncStream([marker])) as unknown as typeof nodeFs.createReadStream;
  (Buffer as unknown as { from: typeof Buffer.from }).from = ((
    value: unknown,
    ...rest: unknown[]
  ): Buffer => {
    if (value === marker) {
      return { length: 1 } as Buffer;
    }

    return (originalBufferFrom as unknown as (...args: unknown[]) => Buffer)(
      value,
      ...rest
    );
  }) as unknown as typeof Buffer.from;

  try {
    assert.equal(await countJsonlLines(filePath), 1);
  } finally {
    nodeFs.createReadStream = originalCreateReadStream;
    Buffer.from = originalBufferFrom;
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
