import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { formatJsonlLine, JsonlEntry } from './entries';
import { throwIfAborted } from './errors';

export interface JsonlLineIndex {
  readonly fileSize: number;
  readonly lineOffsets: number[];
  readonly indexedLineCount: number;
  readonly indexedEndOffset: number;
  readonly isComplete: boolean;
}

export interface JsonlIndexProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly indexedLineCount: number;
}

export interface IndexJsonlFileOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JsonlIndexProgress) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
  readonly lineLimit?: number;
}

export interface FetchJsonlRowsOptions {
  readonly start: number;
  readonly count: number;
  readonly indent: number;
}

export interface JsonlRows {
  readonly start: number;
  readonly entries: JsonlEntry[];
  readonly indexedLineCount: number;
}

export async function indexJsonlFile(
  filePath: string,
  options: IndexJsonlFileOptions = {}
): Promise<JsonlLineIndex> {
  throwIfAborted(options.signal);

  const stats = await fsp.stat(filePath);
  const totalBytes = stats.size;
  const lineLimit = parseOptionalLineLimit(options.lineLimit);
  const lineOffsets: number[] = totalBytes > 0 && lineLimit !== 0 ? [0] : [];
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let bytesRead = 0;
  let lastProgressAt = 0;
  let indexedEndOffset = totalBytes;
  let isComplete = true;

  const emitProgress = (force: boolean): void => {
    if (!options.onProgress) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return;
    }

    lastProgressAt = now;
    options.onProgress({
      bytesRead,
      totalBytes,
      percent:
        totalBytes === 0 ? 100 : Math.min(100, (bytesRead / totalBytes) * 100),
      indexedLineCount: lineOffsets.length
    });
  };

  if (totalBytes === 0) {
    emitProgress(true);
    return {
      fileSize: totalBytes,
      lineOffsets,
      indexedLineCount: 0,
      indexedEndOffset: 0,
      isComplete: true
    };
  }

  if (lineLimit === 0) {
    isComplete = false;
    indexedEndOffset = 0;
    emitProgress(true);
    return {
      fileSize: totalBytes,
      lineOffsets,
      indexedLineCount: 0,
      indexedEndOffset,
      isComplete
    };
  }

  const stream = fs.createReadStream(filePath, {
    highWaterMark: options.chunkSize ?? 64 * 1024
  });

  try {
    emitProgress(true);

    for await (const chunk of stream) {
      throwIfAborted(options.signal);

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as ArrayBuffer);
      const chunkStart = bytesRead;
      let shouldStop = false;

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === 10) {
          const nextLineOffset = chunkStart + index + 1;

          if (lineLimit !== undefined && lineOffsets.length >= lineLimit) {
            indexedEndOffset = nextLineOffset;
            isComplete = nextLineOffset >= totalBytes;
            bytesRead = indexedEndOffset;
            shouldStop = true;
            break;
          }

          if (nextLineOffset < totalBytes) {
            lineOffsets.push(nextLineOffset);
          }
        }
      }

      if (!shouldStop) {
        bytesRead += buffer.length;
      }

      emitProgress(false);
      throwIfAborted(options.signal);

      if (shouldStop) {
        break;
      }
    }

    emitProgress(true);
  } finally {
    stream.destroy();
  }

  return {
    fileSize: totalBytes,
    lineOffsets,
    indexedLineCount: lineOffsets.length,
    indexedEndOffset,
    isComplete
  };
}

export async function fetchJsonlRows(
  filePath: string,
  lineIndex: JsonlLineIndex,
  options: FetchJsonlRowsOptions
): Promise<JsonlRows> {
  const start = clampInteger(options.start, 0, lineIndex.indexedLineCount);
  const count = clampInteger(
    options.count,
    0,
    lineIndex.indexedLineCount - start
  );
  const end = Math.min(lineIndex.indexedLineCount, start + count);

  if (count === 0 || start >= end) {
    return {
      start,
      entries: [],
      indexedLineCount: lineIndex.indexedLineCount
    };
  }

  const startOffset = lineIndex.lineOffsets[start];
  const endOffset =
    end < lineIndex.lineOffsets.length
      ? lineIndex.lineOffsets[end]
      : lineIndex.indexedEndOffset;
  const length = endOffset - startOffset;

  if (length <= 0) {
    return {
      start,
      entries: [],
      indexedLineCount: lineIndex.indexedLineCount
    };
  }

  const file = await fsp.open(filePath, 'r');

  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await file.read(buffer, 0, length, startOffset);
    const text = Buffer.from(buffer.subarray(0, bytesRead)).toString('utf8');
    const rawLines = text.split('\n').slice(0, end - start);
    const entries = rawLines.map((raw, index) =>
      formatJsonlLine(
        start + index + 1,
        stripTrailingCarriageReturn(raw),
        options.indent
      )
    );

    return {
      start,
      entries,
      indexedLineCount: lineIndex.indexedLineCount
    };
  } finally {
    await file.close();
  }
}

function parseOptionalLineLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('lineLimit must be 0 or a positive whole number.');
  }

  return value;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function stripTrailingCarriageReturn(value: string): string {
  return value.endsWith('\r') ? value.slice(0, -1) : value;
}
