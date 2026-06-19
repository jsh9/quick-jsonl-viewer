import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { formatJsonlLine, JsonlEntry } from './entries';
import { throwIfAborted } from './errors';
import { ViewerSettings } from './settings';

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
