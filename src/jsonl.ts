import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as readline from 'node:readline';

export const DEFAULT_MAX_LINES = 20;
export const DEFAULT_INDENT = 2;
export const INDEXED_PREVIEW_LINE_THRESHOLD = 200;

export interface ViewerSettings {
  readonly maxLines: number;
  readonly indent: number;
}

export type JsonlEntry = JsonlJsonEntry | JsonlErrorEntry;

export interface JsonlJsonEntry {
  readonly kind: 'json';
  readonly lineNumber: number;
  readonly raw: string;
  readonly formatted: string;
}

export interface JsonlErrorEntry {
  readonly kind: 'error';
  readonly lineNumber: number;
  readonly raw: string;
  readonly error: string;
}

export interface JsonlPreview {
  readonly entries: JsonlEntry[];
  readonly plainText: string;
  readonly loadedLineCount: number;
  readonly displayLimit: number;
}

export interface JsonlPreviewProgress {
  readonly loadedLineCount: number;
  readonly displayLimit: number;
  readonly percent: number;
}

export interface ReadJsonlPreviewOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JsonlPreviewProgress) => void;
  readonly progressIntervalMs?: number;
}

export interface CountJsonlLinesOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: JsonlLineCountProgress) => void;
  readonly progressIntervalMs?: number;
  readonly chunkSize?: number;
}

export interface JsonlLineCountProgress {
  readonly bytesRead: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly lineCount: number;
}

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

export class JsonlOperationCancelledError extends Error {
  public constructor() {
    super('Operation cancelled.');
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof JsonlOperationCancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function normalizeViewerSettings(input: {
  readonly maxLines?: unknown;
  readonly indent?: unknown;
}): ViewerSettings {
  return {
    maxLines: normalizeInteger(input.maxLines, DEFAULT_MAX_LINES, 0),
    indent: normalizeInteger(input.indent, DEFAULT_INDENT, 1)
  };
}

export function shouldUseIndexedPreview(maxLines: number): boolean {
  return maxLines === 0 || maxLines >= INDEXED_PREVIEW_LINE_THRESHOLD;
}

export function getDisplayRowCount(
  lineCount: number,
  maxLines: number
): number {
  return maxLines === 0 ? lineCount : Math.min(lineCount, maxLines);
}

export function formatJsonlLine(
  lineNumber: number,
  raw: string,
  indent: number
): JsonlEntry {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return {
      kind: 'json',
      lineNumber,
      raw,
      formatted: JSON.stringify(parsed, null, indent)
    };
  } catch (error) {
    return {
      kind: 'error',
      lineNumber,
      raw,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function readJsonlPreview(
  filePath: string,
  settings: ViewerSettings,
  options: ReadJsonlPreviewOptions = {}
): Promise<JsonlPreview> {
  throwIfAborted(options.signal);

  const entries: JsonlEntry[] = [];
  const plainLines: string[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let lineNumber = 0;
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let lastProgressAt = 0;

  const emitProgress = (force: boolean): void => {
    if (!options.onProgress) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressAt < progressIntervalMs) {
      return;
    }

    lastProgressAt = now;
    const displayLimit = settings.maxLines;
    options.onProgress({
      loadedLineCount: entries.length,
      displayLimit,
      percent:
        displayLimit <= 0
          ? 0
          : Math.min(100, (entries.length / displayLimit) * 100)
    });
  };

  try {
    emitProgress(true);

    for await (const line of lineReader) {
      throwIfAborted(options.signal);
      lineNumber += 1;

      if (settings.maxLines === 0 || entries.length < settings.maxLines) {
        entries.push(formatJsonlLine(lineNumber, line, settings.indent));
        plainLines.push(line);
        emitProgress(false);
      }

      if (settings.maxLines > 0 && entries.length >= settings.maxLines) {
        break;
      }

      throwIfAborted(options.signal);
    }

    emitProgress(true);
  } finally {
    lineReader.close();
    stream.destroy();
  }

  return {
    entries,
    plainText: plainLines.join('\n'),
    loadedLineCount: entries.length,
    displayLimit: settings.maxLines
  };
}

export async function countJsonlLines(
  filePath: string,
  options: CountJsonlLinesOptions = {}
): Promise<number> {
  throwIfAborted(options.signal);

  const stats = await fsp.stat(filePath);
  const totalBytes = stats.size;
  let lineCount = 0;
  let hasBytes = false;
  let lastByte = -1;
  let bytesRead = 0;
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let lastProgressAt = 0;

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
      lineCount
    });
  };

  emitProgress(true);

  const stream = fs.createReadStream(filePath, {
    highWaterMark: options.chunkSize ?? 64 * 1024
  });

  try {
    for await (const chunk of stream) {
      throwIfAborted(options.signal);

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as ArrayBuffer);
      hasBytes = hasBytes || buffer.length > 0;

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === 10) {
          lineCount += 1;
        }
      }

      if (buffer.length > 0) {
        lastByte = buffer[buffer.length - 1] ?? -1;
      }

      bytesRead += buffer.length;
      emitProgress(false);
      throwIfAborted(options.signal);
    }
  } finally {
    stream.destroy();
  }

  throwIfAborted(options.signal);

  if (hasBytes && lastByte !== 10) {
    lineCount += 1;
  }

  // Emit after the no-trailing-newline adjustment so progress listeners see
  // the same final count returned to callers.
  emitProgress(true);

  return lineCount;
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

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return String(bytes) + ' B';
  }

  return value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    return fallback;
  }

  return value;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new JsonlOperationCancelledError();
  }
}
