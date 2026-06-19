import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { fetchJsonlRows, getDisplayRowCount, JsonlLineIndex } from './jsonl';
import { FILE_RELOAD_DEBOUNCE_MS, SETTINGS_SECTION } from './constants';
import { getHtml } from './webview/html';
import {
  ExactLineCountCache,
  ExactLineCountRequest,
  FileSnapshot,
  isSameFileSnapshot,
  postJsonlData,
  startExactLineCount
} from './viewerData';
import {
  clampMessageInteger,
  formatError,
  getSettings,
  getWebviewRenderMode,
  WebviewMessage
} from './viewerProtocol';

export class JsonlDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // No document-level resources are held.
  }
}

export class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider<JsonlDocument> {
  public async openCustomDocument(uri: vscode.Uri): Promise<JsonlDocument> {
    return new JsonlDocument(uri);
  }

  public async resolveCustomEditor(
    document: JsonlDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true
    };
    webviewPanel.webview.html = getHtml(path.basename(document.uri.fsPath));
    webviewPanel.reveal(webviewPanel.viewColumn, false);

    const disposables: vscode.Disposable[] = [];
    let generation = 0;
    let webviewReady = false;
    let abortController: AbortController | undefined;
    let fullIndex: JsonlLineIndex | undefined;
    let currentSettings = getSettings();
    let fileReloadTimer: ReturnType<typeof setTimeout> | undefined;
    let currentFileSnapshot: FileSnapshot | undefined;
    let exactLineCountCache: ExactLineCountCache | undefined;
    let exactLineCountRequest: ExactLineCountRequest | undefined;

    const cancelCurrentWork = (): void => {
      abortController?.abort();
      abortController = undefined;
      fullIndex = undefined;
    };

    const abortExactLineCount = (): void => {
      exactLineCountRequest?.controller.abort();
      exactLineCountRequest = undefined;
    };

    const invalidateExactLineCount = (): void => {
      abortExactLineCount();
      exactLineCountCache = undefined;
    };

    const noteFileSnapshot = (snapshot: FileSnapshot): void => {
      if (
        currentFileSnapshot &&
        isSameFileSnapshot(currentFileSnapshot, snapshot)
      ) {
        return;
      }

      // Treat exact line counts as file-version state, not view state. A real
      // file change invalidates stale counts; settings-only reloads do not.
      invalidateExactLineCount();
      currentFileSnapshot = snapshot;
    };

    const getCachedLineCount = (snapshot: FileSnapshot): number | undefined =>
      exactLineCountCache &&
      isSameFileSnapshot(exactLineCountCache.snapshot, snapshot)
        ? exactLineCountCache.lineCount
        : undefined;

    const setCachedLineCount = (
      snapshot: FileSnapshot,
      lineCount: number
    ): void => {
      exactLineCountCache = {
        snapshot,
        lineCount
      };

      if (
        exactLineCountRequest &&
        isSameFileSnapshot(exactLineCountRequest.snapshot, snapshot)
      ) {
        exactLineCountRequest.controller.abort();
        exactLineCountRequest = undefined;
      }
    };

    const clearExactLineCountRequest = (snapshot: FileSnapshot): void => {
      if (
        exactLineCountRequest &&
        isSameFileSnapshot(exactLineCountRequest.snapshot, snapshot)
      ) {
        exactLineCountRequest = undefined;
      }
    };

    const ensureExactLineCount = (snapshot: FileSnapshot): void => {
      if (getCachedLineCount(snapshot) !== undefined) {
        return;
      }

      // Keep line counting single-flight for a snapshot so changing row
      // limits can rerender without starting another full-file scan.
      if (
        exactLineCountRequest &&
        isSameFileSnapshot(exactLineCountRequest.snapshot, snapshot)
      ) {
        return;
      }

      abortExactLineCount();
      const controller = new AbortController();
      exactLineCountRequest = {
        snapshot,
        controller
      };

      startExactLineCount(
        document.uri.fsPath,
        webviewPanel.webview,
        snapshot,
        () => currentFileSnapshot,
        controller.signal,
        setCachedLineCount,
        clearExactLineCountRequest
      );
    };

    const load = async (): Promise<void> => {
      cancelCurrentWork();
      const currentGeneration = ++generation;
      const controller = new AbortController();
      abortController = controller;
      fullIndex = undefined;
      currentSettings = getSettings();

      await postJsonlData(
        document.uri,
        webviewPanel.webview,
        currentGeneration,
        () => generation,
        controller.signal,
        currentSettings,
        (index) => {
          fullIndex = index;
        },
        {
          noteFileSnapshot,
          getCachedLineCount,
          setCachedLineCount,
          ensureExactLineCount
        }
      );
    };

    const safeLoad = (): void => {
      if (!webviewReady) {
        return;
      }

      void load().catch(async (error: unknown) => {
        await webviewPanel.webview.postMessage({
          type: 'error',
          message: formatError(error)
        });
      });
    };

    const scheduleFileReload = (): void => {
      if (!webviewReady) {
        return;
      }

      // Collapse clustered save/watch events into one reload so the current
      // abort/generation path clears stale indexes without thrashing the UI.
      invalidateExactLineCount();

      if (fileReloadTimer) {
        clearTimeout(fileReloadTimer);
      }

      fileReloadTimer = setTimeout(() => {
        fileReloadTimer = undefined;
        safeLoad();
      }, FILE_RELOAD_DEBOUNCE_MS);
    };

    const handleFetchRows = async (message: WebviewMessage): Promise<void> => {
      if (!fullIndex) {
        await webviewPanel.webview.postMessage({
          type: 'error',
          message: 'The full-file index is not ready yet.'
        });
        return;
      }

      const requestGeneration = generation;
      const requestId =
        typeof message.requestId === 'string' ? message.requestId : '';
      const mode = getWebviewRenderMode(message.mode);
      const totalRows = getDisplayRowCount(
        fullIndex.indexedLineCount,
        currentSettings.maxLines
      );
      const start = clampMessageInteger(message.start, 0, totalRows);
      const count = clampMessageInteger(message.count, 0, totalRows - start);
      const rows = await fetchJsonlRows(document.uri.fsPath, fullIndex, {
        start,
        count,
        indent: currentSettings.indent
      });

      if (requestGeneration !== generation) {
        return;
      }

      await webviewPanel.webview.postMessage({
        type: 'rows',
        requestId,
        mode,
        payload: {
          ...rows,
          start,
          totalLines: totalRows
        }
      });
    };

    const handleUpdateMaxLines = async (
      message: WebviewMessage
    ): Promise<void> => {
      const value =
        typeof message.value === 'number' ? message.value : Number.NaN;
      if (!Number.isInteger(value) || value < 0) {
        await webviewPanel.webview.postMessage({
          type: 'maxLinesError',
          message: 'Rows must be 0 or a positive whole number.'
        });
        return;
      }

      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update('maxLines', value, vscode.ConfigurationTarget.Global);
    };

    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'ready') {
          webviewReady = true;
          safeLoad();
          return;
        }

        if (message.type === 'cancelIndex') {
          abortController?.abort();
          void webviewPanel.webview.postMessage({ type: 'fullIndexCancelled' });
          return;
        }

        if (message.type === 'fetchRows') {
          void handleFetchRows(message).catch(async (error: unknown) => {
            await webviewPanel.webview.postMessage({
              type: 'error',
              message: formatError(error)
            });
          });
          return;
        }

        if (message.type === 'updateMaxLines') {
          void handleUpdateMaxLines(message).catch(async (error: unknown) => {
            await webviewPanel.webview.postMessage({
              type: 'maxLinesError',
              message: formatError(error)
            });
          });
          return;
        }

        if (message.type === 'rawContents') {
          void vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default',
            webviewPanel.viewColumn ?? vscode.ViewColumn.Active
          );
        }
      })
    );

    disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${SETTINGS_SECTION}.maxLines`) ||
          event.affectsConfiguration(`${SETTINGS_SECTION}.indent`)
        ) {
          safeLoad();
        }
      })
    );

    disposables.push(
      vscode.workspace.onDidSaveTextDocument((textDocument) => {
        if (textDocument.uri.toString() === document.uri.toString()) {
          scheduleFileReload();
        }
      })
    );

    if (document.uri.scheme === 'file') {
      try {
        // Watch the parent directory because Node's fs.watch is file-system
        // dependent; filtering here keeps external edits from using stale
        // byte offsets while save events still cover normal VS Code edits.
        const directoryWatcher = nodeFs.watch(
          path.dirname(document.uri.fsPath),
          (_eventType, changedFileName) => {
            const changedName = changedFileName
              ? changedFileName.toString()
              : undefined;
            if (
              !changedName ||
              changedName === path.basename(document.uri.fsPath)
            ) {
              scheduleFileReload();
            }
          }
        );
        directoryWatcher.on('error', () => {
          // Save events still cover VS Code edits when native directory watching fails.
        });
        disposables.push({
          dispose: () => {
            directoryWatcher.close();
          }
        });
      } catch {
        // Some filesystems do not support native watching; save events still reload VS Code edits.
      }
    }

    webviewPanel.onDidDispose(() => {
      cancelCurrentWork();
      currentFileSnapshot = undefined;
      abortExactLineCount();
      if (fileReloadTimer) {
        clearTimeout(fileReloadTimer);
      }
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });

    safeLoad();
  }
}
