import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { throwIfAborted } from './errors';

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
