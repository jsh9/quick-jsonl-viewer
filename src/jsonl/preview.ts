import { getJsonlEntryPlainText, JsonlEntry } from './entries';
import { throwIfAborted } from './errors';
import { fetchJsonlRows, indexJsonlFile } from './lineIndex';
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
  readonly maxRowBytes?: number;
  readonly oversizedPreviewBytes?: number;
}

export async function readJsonlPreview(
  filePath: string,
  settings: Pick<ViewerSettings, 'maxLines' | 'indent'> & {
    readonly startLine?: unknown;
  },
  options: ReadJsonlPreviewOptions = {}
): Promise<JsonlPreview> {
  throwIfAborted(options.signal);

  const startLine =
    typeof settings.startLine === 'number' &&
    Number.isInteger(settings.startLine) &&
    settings.startLine >= 1
      ? settings.startLine
      : 1;
  const progressIntervalMs = options.progressIntervalMs ?? 100;
  let lastProgressAt = 0;

  const emitProgress = (loadedLineCount: number, force: boolean): void => {
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
      loadedLineCount,
      displayLimit,
      percent:
        displayLimit <= 0
          ? 0
          : Math.min(100, (loadedLineCount / displayLimit) * 100)
    });
  };

  emitProgress(0, true);

  const lineLimit =
    settings.maxLines > 0 ? startLine - 1 + settings.maxLines : undefined;
  const index = await indexJsonlFile(filePath, {
    signal: options.signal,
    lineLimit
  });
  throwIfAborted(options.signal);

  const startIndex = startLine - 1;
  const count =
    settings.maxLines === 0
      ? Math.max(0, index.indexedLineCount - startIndex)
      : settings.maxLines;
  const rows = await fetchJsonlRows(filePath, index, {
    start: startIndex,
    count,
    indent: settings.indent,
    maxRowBytes: options.maxRowBytes,
    oversizedPreviewBytes: options.oversizedPreviewBytes
  });
  const entries: JsonlEntry[] = rows.entries;
  const plainLines = entries.map(getJsonlEntryPlainText);

  emitProgress(entries.length, true);

  return {
    entries,
    plainText: plainLines.join('\n'),
    loadedLineCount: entries.length,
    displayLimit: settings.maxLines
  };
}
