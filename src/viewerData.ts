import type * as nodeFs from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  countJsonlLines,
  formatFileSize,
  indexJsonlFile,
  isAbortError,
  JsonlLineIndex,
  JsonlPreview,
  readJsonlPreview,
  shouldUseIndexedPreview,
  ViewerSettings
} from './jsonl';
import { formatError } from './viewerProtocol';

export interface JsonlDataPayload {
  readonly fileName: string;
  readonly fileSize: string;
  readonly lastModified: string;
  readonly maxLines: number;
  readonly indent: number;
  readonly lineCount: number | null;
  readonly preview: JsonlPreview;
}

export interface FileSnapshot {
  readonly size: number;
  readonly mtimeMs: number;
}

export interface ExactLineCountCache {
  readonly snapshot: FileSnapshot;
  readonly lineCount: number;
}

export interface ExactLineCountRequest {
  readonly snapshot: FileSnapshot;
  readonly controller: AbortController;
}

export interface ExactLineCountCoordinator {
  readonly noteFileSnapshot: (snapshot: FileSnapshot) => void;
  readonly getCachedLineCount: (snapshot: FileSnapshot) => number | undefined;
  readonly setCachedLineCount: (
    snapshot: FileSnapshot,
    lineCount: number
  ) => void;
  readonly ensureExactLineCount: (snapshot: FileSnapshot) => void;
}

export async function postJsonlData(
  uri: vscode.Uri,
  webview: vscode.Webview,
  generation: number,
  getLatestGeneration: () => number,
  signal: AbortSignal,
  settings: ViewerSettings,
  setFullIndex: (index: JsonlLineIndex) => void,
  exactLineCounts: ExactLineCountCoordinator
): Promise<void> {
  if (uri.scheme !== 'file') {
    await webview.postMessage({
      type: 'error',
      message: `Quick JSONL Viewer only supports file-backed JSONL documents. Unsupported URI scheme: ${uri.scheme}.`
    });
    return;
  }

  await webview.postMessage({ type: 'loading' });

  try {
    const stats = await fs.stat(uri.fsPath);
    const snapshot = getFileSnapshot(stats);
    exactLineCounts.noteFileSnapshot(snapshot);
    const metadata = {
      fileName: path.basename(uri.fsPath),
      fileSize: formatFileSize(stats.size),
      lastModified: stats.mtime.toLocaleString(),
      maxLines: settings.maxLines,
      indent: settings.indent
    };

    if (shouldUseIndexedPreview(settings.maxLines)) {
      const lineLimit = settings.maxLines > 0 ? settings.maxLines : undefined;
      await webview.postMessage({
        type: 'fullIndexStart',
        payload: {
          ...metadata,
          totalBytes: stats.size
        }
      });

      const index = await indexJsonlFile(uri.fsPath, {
        signal,
        lineLimit,
        onProgress: (progress) => {
          if (generation !== getLatestGeneration()) {
            return;
          }

          void webview.postMessage({
            type: 'fullIndexProgress',
            payload: progress
          });
        }
      });

      if (generation !== getLatestGeneration()) {
        return;
      }

      setFullIndex(index);
      if (index.isComplete) {
        exactLineCounts.setCachedLineCount(snapshot, index.indexedLineCount);
      }

      const lineCount = exactLineCounts.getCachedLineCount(snapshot);
      await webview.postMessage({
        type: 'fullIndexReady',
        payload: {
          ...metadata,
          lineCount: lineCount ?? null,
          totalRows: index.indexedLineCount,
          isComplete: index.isComplete
        }
      });

      if (shouldStartExactLineCount(index)) {
        exactLineCounts.ensureExactLineCount(snapshot);
      }

      return;
    }

    await webview.postMessage({
      type: 'previewLoadStart',
      payload: {
        ...metadata,
        displayLimit: settings.maxLines
      }
    });

    const preview = await readJsonlPreview(uri.fsPath, settings, {
      signal,
      onProgress: (progress) => {
        if (generation !== getLatestGeneration()) {
          return;
        }

        void webview.postMessage({
          type: 'previewLoadProgress',
          payload: progress
        });
      }
    });

    if (generation !== getLatestGeneration()) {
      return;
    }

    await webview.postMessage({
      type: 'data',
      payload: {
        ...metadata,
        lineCount: exactLineCounts.getCachedLineCount(snapshot) ?? null,
        preview
      } satisfies JsonlDataPayload
    });

    if (shouldStartExactLineCount()) {
      exactLineCounts.ensureExactLineCount(snapshot);
    }
  } catch (error) {
    if (generation !== getLatestGeneration()) {
      return;
    }

    if (isAbortError(error)) {
      await webview.postMessage({ type: 'fullIndexCancelled' });
      return;
    }

    await webview.postMessage({
      type: 'error',
      message: formatError(error)
    });
  }
}

export function shouldStartExactLineCount(index?: JsonlLineIndex): boolean {
  return index ? !index.isComplete : true;
}

export function startExactLineCount(
  filePath: string,
  webview: vscode.Webview,
  snapshot: FileSnapshot,
  getCurrentFileSnapshot: () => FileSnapshot | undefined,
  signal: AbortSignal,
  setCachedLineCount: (snapshot: FileSnapshot, lineCount: number) => void,
  clearExactLineCountRequest: (snapshot: FileSnapshot) => void
): void {
  const isCurrentSnapshot = (): boolean => {
    const currentSnapshot = getCurrentFileSnapshot();
    return Boolean(
      currentSnapshot && isSameFileSnapshot(currentSnapshot, snapshot)
    );
  };

  void countJsonlLines(filePath, {
    signal,
    onProgress: (progress) => {
      // Progress is tied to the file snapshot rather than the render
      // generation so settings-only reloads can keep the same count alive.
      if (!isCurrentSnapshot()) {
        return;
      }

      void webview.postMessage({
        type: 'lineCountProgress',
        payload: progress
      });
    }
  })
    .then(async (lineCount) => {
      if (!isCurrentSnapshot() || signal.aborted) {
        return;
      }

      setCachedLineCount(snapshot, lineCount);
      await webview.postMessage({
        type: 'lineCount',
        lineCount
      });
    })
    .catch(async (error: unknown) => {
      if (!isCurrentSnapshot() || isAbortError(error)) {
        return;
      }

      await webview.postMessage({
        type: 'lineCountError',
        message: formatError(error)
      });
    })
    .finally(() => {
      clearExactLineCountRequest(snapshot);
    });
}

export function getFileSnapshot(
  stats: Pick<nodeFs.Stats, 'size' | 'mtimeMs'>
): FileSnapshot {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

export function isSameFileSnapshot(
  left: FileSnapshot,
  right: FileSnapshot
): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}
