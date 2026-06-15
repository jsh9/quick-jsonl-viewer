import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  countJsonlLines,
  fetchJsonlRows,
  formatFileSize,
  getDisplayRowCount,
  indexJsonlFile,
  INDEXED_PREVIEW_LINE_THRESHOLD,
  isAbortError,
  JsonlLineIndex,
  JsonlPreview,
  normalizeViewerSettings,
  readJsonlPreview,
  shouldUseIndexedPreview,
  ViewerSettings
} from './jsonl';

const VIEW_TYPE = 'quickJsonlViewer.viewer';
const SETTINGS_SECTION = 'quickJsonlViewer';
const SAMPLE_JSONL_PATHS = ['sample-data/sample-data.jsonl', 'sample-data/large-placeholder.jsonl'];

type WebviewRenderMode = 'pretty' | 'wrappedRaw' | 'rawLine';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('quickJsonlViewer.openCurrentFile', (resource?: vscode.Uri) => {
      void openJsonlViewer(resource).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Quick JSONL Viewer failed to open the file: ${formatError(error)}`);
      });
    }),
    vscode.commands.registerCommand('quickJsonlViewer.openSampleFiles', () => {
      void openSampleJsonlFiles(context.extensionUri).catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Quick JSONL Viewer failed to open sample files: ${formatError(error)}`);
      });
    }),
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new JsonlViewerProvider(),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
}

export function deactivate(): void {
  // Nothing to dispose; VS Code owns provider subscriptions registered on activation.
}

async function openJsonlViewer(resource?: vscode.Uri): Promise<void> {
  const uri = resource ?? getActiveEditorUri();

  if (!uri) {
    void vscode.window.showWarningMessage('Open a JSONL file before running Quick JSONL Viewer.');
    return;
  }

  if (!isJsonlFile(uri)) {
    void vscode.window.showWarningMessage('Quick JSONL Viewer can only open .jsonl files.');
    return;
  }

  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, vscode.ViewColumn.Active);
}

async function openSampleJsonlFiles(extensionUri: vscode.Uri): Promise<void> {
  for (const [index, relativePath] of SAMPLE_JSONL_PATHS.entries()) {
    const uri = vscode.Uri.joinPath(extensionUri, ...relativePath.split('/'));
    const column = index === 0 ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, column);
  }
}

function getActiveEditorUri(): vscode.Uri | undefined {
  const activeTextEditorUri = vscode.window.activeTextEditor?.document.uri;

  if (activeTextEditorUri) {
    return activeTextEditorUri;
  }

  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }

  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }

  return undefined;
}

function isJsonlFile(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && path.extname(uri.fsPath).toLowerCase() === '.jsonl';
}

class JsonlDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // No document-level resources are held.
  }
}

class JsonlViewerProvider implements vscode.CustomReadonlyEditorProvider<JsonlDocument> {
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

    const disposables: vscode.Disposable[] = [];
    let generation = 0;
    let webviewReady = false;
    let abortController: AbortController | undefined;
    let fullIndex: JsonlLineIndex | undefined;
    let currentSettings = getSettings();

    const cancelCurrentWork = (): void => {
      abortController?.abort();
      abortController = undefined;
      fullIndex = undefined;
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

    const handleFetchRows = async (message: WebviewMessage): Promise<void> => {
      if (!fullIndex) {
        await webviewPanel.webview.postMessage({
          type: 'error',
          message: 'The full-file index is not ready yet.'
        });
        return;
      }

      const requestGeneration = generation;
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const mode = getWebviewRenderMode(message.mode);
      const totalRows = getDisplayRowCount(fullIndex.indexedLineCount, currentSettings.maxLines);
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

    const handleUpdateMaxLines = async (message: WebviewMessage): Promise<void> => {
      const value = typeof message.value === 'number' ? message.value : Number.NaN;
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

    webviewPanel.onDidDispose(() => {
      cancelCurrentWork();
      for (const disposable of disposables) {
        disposable.dispose();
      }
    });

    safeLoad();
  }
}

function getWebviewRenderMode(value: unknown): WebviewRenderMode {
  if (value === 'wrappedRaw' || value === 'rawLine') {
    return value;
  }

  return 'pretty';
}

async function postJsonlData(
  uri: vscode.Uri,
  webview: vscode.Webview,
  generation: number,
  getLatestGeneration: () => number,
  signal: AbortSignal,
  settings: ViewerSettings,
  setFullIndex: (index: JsonlLineIndex) => void
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
      await webview.postMessage({
        type: 'fullIndexReady',
        payload: {
          ...metadata,
          lineCount: index.isComplete ? index.indexedLineCount : null,
          totalRows: index.indexedLineCount,
          isComplete: index.isComplete
        }
      });

      if (shouldStartExactLineCount(index)) {
        startExactLineCount(uri.fsPath, webview, generation, getLatestGeneration, signal);
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
        lineCount: null,
        preview
      } satisfies JsonlDataPayload
    });

    if (shouldStartExactLineCount()) {
      startExactLineCount(uri.fsPath, webview, generation, getLatestGeneration, signal);
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

function shouldStartExactLineCount(index?: JsonlLineIndex): boolean {
  return index ? !index.isComplete : true;
}

function startExactLineCount(
  filePath: string,
  webview: vscode.Webview,
  generation: number,
  getLatestGeneration: () => number,
  signal: AbortSignal
): void {
  void countJsonlLines(filePath, { signal })
    .then(async (lineCount) => {
      if (generation !== getLatestGeneration() || signal.aborted) {
        return;
      }

      await webview.postMessage({
        type: 'lineCount',
        lineCount
      });
    })
    .catch(async (error: unknown) => {
      if (generation !== getLatestGeneration() || isAbortError(error)) {
        return;
      }

      await webview.postMessage({
        type: 'lineCountError',
        message: formatError(error)
      });
    });
}

function getSettings(): ViewerSettings {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return normalizeViewerSettings({
    maxLines: configuration.get('maxLines'),
    indent: configuration.get('indent')
  });
}

function clampMessageInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

interface JsonlDataPayload {
  readonly fileName: string;
  readonly fileSize: string;
  readonly lastModified: string;
  readonly maxLines: number;
  readonly indent: number;
  readonly lineCount: number | null;
  readonly preview: JsonlPreview;
}

interface WebviewMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly start?: unknown;
  readonly count?: unknown;
  readonly mode?: unknown;
  readonly value?: unknown;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getHtml(fileName: string): string {
  const nonce = getNonce();
  const escapedTitle = escapeHtml(fileName);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
    }

    .info-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .info-item:not(:first-child)::before {
      content: "|";
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      user-select: none;
    }

    .info strong {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .rows-control {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .rows-input {
      appearance: textfield;
      -moz-appearance: textfield;
      width: 72px;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
      border-radius: 3px;
      padding: 2px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }

    .rows-input::-webkit-inner-spin-button,
    .rows-input::-webkit-outer-spin-button {
      margin: 0;
      -webkit-appearance: none;
    }

    .rows-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .rows-input.invalid {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-input-foreground));
    }

    .rows-input:disabled {
      opacity: 0.55;
    }

    .rows-error {
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      flex-wrap: wrap;
    }

    button {
      min-width: 104px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 4px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .mode-tabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .mode-button {
      min-width: auto;
      border: 0;
      padding: 4px 9px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .mode-button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .mode-button.raw-action {
      border-left: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 0 2px 2px 0;
    }

    main {
      padding: 12px;
    }

    .status,
    .error-panel {
      margin: 0 0 12px;
      color: var(--vscode-descriptionForeground);
    }

    .error-panel {
      padding: 10px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .entry {
      display: grid;
      grid-template-columns: minmax(44px, max-content) minmax(0, 1fr);
      gap: 10px;
      margin: 0 0 10px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }

    .entry.error {
      border-color: var(--vscode-inputValidation-warningBorder);
    }

    .line-number {
      padding: 10px 8px;
      color: var(--vscode-editorLineNumber-foreground);
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
      text-align: right;
      user-select: none;
    }

    .line-body {
      min-width: 0;
      padding: 10px 12px;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
    }

    .entry.raw-line .line-body {
      overflow-x: auto;
    }

    .entry.raw-line pre {
      white-space: pre;
      overflow-wrap: normal;
    }

    .json-token.key {
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
    }

    .json-token.string {
      color: var(--vscode-debugTokenExpression-string, #ce9178);
    }

    .json-token.number {
      color: var(--vscode-debugTokenExpression-number, #b5cea8);
    }

    .json-token.boolean,
    .json-token.null {
      color: var(--vscode-debugTokenExpression-boolean, #569cd6);
    }

    .json-token.punctuation {
      color: var(--vscode-descriptionForeground);
    }

    .parse-error {
      margin: 0 0 8px;
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground));
      font-weight: 600;
    }

    .progress-panel {
      display: grid;
      gap: 10px;
      max-width: 720px;
      padding: 12px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-progressBar-background, var(--vscode-editorWidget-border));
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 120ms linear;
    }

    .progress-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--vscode-descriptionForeground);
    }

    .virtual-scroll {
      height: calc(100vh - 78px);
      min-height: 240px;
      overflow: auto;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .virtual-spacer {
      position: relative;
      min-height: 100%;
    }

    .virtual-rows {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }

    .virtual-row {
      margin: 4px 6px;
    }

    .virtual-row.raw-line .line-body {
      overflow-x: auto;
    }

    @media (max-width: 640px) {
      .topbar {
        align-items: stretch;
        flex-direction: column;
      }

      .actions,
      .mode-tabs {
        width: 100%;
      }

      .mode-button {
        flex: 1 1 auto;
      }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="info" aria-live="polite">
      <span class="info-item"><strong>Size:</strong> <span id="file-size">Loading...</span></span>
      <span class="info-item"><strong>Total lines:</strong> <span id="line-count">Counting...</span></span>
      <label class="rows-control info-item"><strong>Show</strong> <input id="rows-input" class="rows-input" type="number" min="0" step="1" inputmode="numeric" aria-describedby="rows-error"> <span>rows</span></label>
      <span id="rows-error" class="rows-error" role="status"></span>
      <span class="info-item"><strong>Modified:</strong> <span id="modified">Loading...</span></span>
      <span id="preview-status"></span>
    </div>
    <div class="actions">
      <div class="mode-tabs" role="toolbar" aria-label="JSONL view mode">
        <button class="mode-button" type="button" data-mode="pretty" aria-pressed="true">Pretty print</button>
        <button class="mode-button" type="button" data-mode="wrappedRaw" aria-pressed="false">Wrapped raw</button>
        <button class="mode-button" type="button" data-mode="rawLine" aria-pressed="false">Raw line</button>
        <button class="mode-button raw-action" type="button" id="raw-contents">Raw contents</button>
      </div>
    </div>
  </header>
  <main id="content">
    <p class="status">Loading JSONL preview...</p>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
    const rawContentsButton = document.getElementById('raw-contents');
    const fileSize = document.getElementById('file-size');
    const lineCount = document.getElementById('line-count');
    const rowsInput = document.getElementById('rows-input');
    const rowsError = document.getElementById('rows-error');
    const modified = document.getElementById('modified');
    const previewStatus = document.getElementById('preview-status');

    const OVERSCAN = 8;
    const PRETTY_ROW_HEIGHT = 180;
    const WRAPPED_RAW_ROW_HEIGHT = 82;
    const RAW_ROW_HEIGHT = 46;
    const LIMITED_VIRTUAL_THRESHOLD = ${INDEXED_PREVIEW_LINE_THRESHOLD};

    let mode = 'pretty';
    let viewState = 'loading';
    let data = null;
    let full = null;
    let fullProgress = null;
    let previewLoad = null;
    let previewProgress = null;
    let virtualScroll = null;
    let virtualSpacer = null;
    let virtualRows = null;
    let latestRequestId = 0;
    let pendingRequestId = '';
    let animationFrame = 0;
    let lastSubmittedMaxLines = '';
    let measuredRowHeights = new Map();
    let currentVirtualStart = 0;
    let currentVirtualTotalRows = 0;

    for (const button of modeButtons) {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.mode || 'pretty';
        if (nextMode === mode) {
          return;
        }

        mode = nextMode;
        resetVirtualMeasurements();
        updateModeButtons();

        if (viewState === 'fullReady') {
          renderFullViewer();
          return;
        }

        renderLimited();
      });
    }

    rawContentsButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'rawContents' });
    });

    rowsInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitMaxLines();
      }
    });

    rowsInput.addEventListener('blur', () => {
      submitMaxLines();
    });

    rowsInput.addEventListener('input', () => {
      clearRowsError();
    });

    window.addEventListener('message', (event) => {
      const message = event.data;

      if (message.type === 'loading') {
        viewState = 'loading';
        data = null;
        full = null;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        renderLoading();
        return;
      }

      if (message.type === 'data') {
        viewState = 'limited';
        data = message.payload;
        full = null;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        renderLimited();
        return;
      }

      if (message.type === 'lineCount') {
        if (data) {
          data.lineCount = message.lineCount;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.lineCount = message.lineCount;
          renderFullInfo();
          return;
        }

        return;
      }

      if (message.type === 'lineCountError') {
        lineCount.textContent = 'Unavailable';
        return;
      }

      if (message.type === 'maxLinesError') {
        showRowsError(message.message || 'Rows must be 0 or a positive whole number.');
        return;
      }

      if (message.type === 'previewLoadStart') {
        viewState = 'previewLoading';
        data = null;
        full = null;
        previewLoad = message.payload;
        previewProgress = {
          loadedLineCount: 0,
          displayLimit: message.payload.displayLimit,
          percent: 0
        };
        resetVirtualMeasurements();
        renderPreviewLoading();
        return;
      }

      if (message.type === 'previewLoadProgress') {
        previewProgress = message.payload;
        if (viewState === 'previewLoading') {
          renderPreviewLoading();
        }
        return;
      }

      if (message.type === 'fullIndexStart') {
        viewState = 'fullIndexing';
        data = null;
        full = message.payload;
        previewLoad = null;
        previewProgress = null;
        resetVirtualMeasurements();
        fullProgress = {
          bytesRead: 0,
          totalBytes: message.payload.totalBytes,
          percent: 0,
          indexedLineCount: 0
        };
        renderFullIndexing();
        return;
      }

      if (message.type === 'fullIndexProgress') {
        fullProgress = message.payload;
        if (viewState === 'fullIndexing') {
          renderFullIndexing();
        }
        return;
      }

      if (message.type === 'fullIndexReady') {
        viewState = 'fullReady';
        full = message.payload;
        fullProgress = null;
        resetVirtualMeasurements();
        renderFullViewer();
        return;
      }

      if (message.type === 'fullIndexCancelled') {
        viewState = 'cancelled';
        renderCancelled();
        return;
      }

      if (message.type === 'rows') {
        if (message.requestId !== pendingRequestId || viewState !== 'fullReady') {
          return;
        }

        renderVirtualRows(message.payload.start, message.payload.entries, message.payload.totalLines, message.mode);
        return;
      }

      if (message.type === 'error') {
        data = null;
        full = null;
        viewState = 'error';
        renderError(message.message);
      }
    });

    function renderLoading() {
      setControlsDisabled(true);
      fileSize.textContent = 'Loading...';
      lineCount.textContent = 'Counting...';
      rowsInput.value = '';
      lastSubmittedMaxLines = '';
      modified.textContent = 'Loading...';
      previewStatus.textContent = '';
      clearRowsError();
      content.replaceChildren(status('Loading JSONL preview...'));
    }

    function renderError(message) {
      setControlsDisabled(true);
      fileSize.textContent = 'Unavailable';
      lineCount.textContent = 'Unavailable';
      rowsInput.value = '';
      lastSubmittedMaxLines = '';
      modified.textContent = 'Unavailable';
      previewStatus.textContent = '';
      clearRowsError();
      const panel = document.createElement('div');
      panel.className = 'error-panel';
      panel.textContent = message || 'Unable to load JSONL file.';
      content.replaceChildren(panel);
    }

    function renderCancelled() {
      setControlsDisabled(true);
      previewStatus.textContent = 'Loading cancelled';
      content.replaceChildren(status('Loading was cancelled. Change settings or reopen the file to start again.'));
    }

    function renderPreviewLoading() {
      if (!previewLoad || !previewProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = previewLoad.fileSize;
      lineCount.textContent = 'Counting...';
      rowsInput.value = String(previewLoad.maxLines);
      lastSubmittedMaxLines = rowsInput.value;
      modified.textContent = previewLoad.lastModified;
      previewStatus.textContent = 'Loading preview ' + formatPercent(previewProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = 'Loading preview...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, previewProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatInteger(previewProgress.loadedLineCount) + ' / ' + formatInteger(previewProgress.displayLimit) + ' rows loaded')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelIndex' });
      });

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function renderLimited() {
      if (!data) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      updateModeButtons();
      renderLimitedInfo();

      if (data.preview.entries.length >= LIMITED_VIRTUAL_THRESHOLD) {
        renderLimitedVirtualViewer();
        return;
      }

      const fragment = document.createDocumentFragment();
      if (data.preview.entries.length === 0) {
        fragment.append(status('No lines loaded from this JSONL file.'));
      }

      for (const entry of data.preview.entries) {
        fragment.append(renderEntry(entry, mode, false));
      }

      content.replaceChildren(fragment);
    }

    function renderLimitedVirtualViewer() {
      if (!data) {
        renderLoading();
        return;
      }

      viewState = 'limitedVirtual';
      virtualScroll = document.createElement('div');
      virtualScroll.className = 'virtual-scroll';
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualTotalHeight(data.preview.entries.length)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      virtualScroll.append(virtualSpacer);
      content.replaceChildren(virtualScroll);

      requestLimitedVisibleRows();
    }

    function renderLimitedInfo() {
      fileSize.textContent = data.fileSize;
      lineCount.textContent = data.lineCount === null ? 'Counting...' : formatInteger(data.lineCount);
      rowsInput.value = String(data.maxLines);
      lastSubmittedMaxLines = rowsInput.value;
      modified.textContent = data.lastModified;

      const loaded = data.preview.loadedLineCount;
      const limit = data.maxLines;
      if (loaded >= limit) {
        previewStatus.textContent = 'Showing first ' + formatInteger(loaded) + ' lines';
      } else {
        previewStatus.textContent = 'Showing ' + formatInteger(loaded) + ' loaded lines';
      }
    }

    function renderFullIndexing() {
      if (!full || !fullProgress) {
        renderLoading();
        return;
      }

      setControlsDisabled(true);
      fileSize.textContent = full.fileSize;
      lineCount.textContent = 'Indexing...';
      rowsInput.value = String(full.maxLines);
      lastSubmittedMaxLines = rowsInput.value;
      modified.textContent = full.lastModified;
      const indexingLabel = full.maxLines === 0 ? 'Indexing full file' : 'Preparing indexed preview';
      previewStatus.textContent = indexingLabel + ' ' + formatPercent(fullProgress.percent);

      const panel = document.createElement('section');
      panel.className = 'progress-panel';

      const title = document.createElement('p');
      title.className = 'status';
      title.textContent = indexingLabel + '...';

      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = Math.max(0, Math.min(100, fullProgress.percent)) + '%';
      track.append(bar);

      const meta = document.createElement('div');
      meta.className = 'progress-meta';
      meta.append(
        textSpan(formatPercent(fullProgress.percent)),
        textSpan(formatBytes(fullProgress.bytesRead) + ' / ' + formatBytes(fullProgress.totalBytes)),
        textSpan(formatInteger(fullProgress.indexedLineCount) + ' lines found')
      );

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelIndex' });
      });

      panel.append(title, track, meta, cancel);
      content.replaceChildren(panel);
    }

    function renderFullViewer() {
      if (!full) {
        renderLoading();
        return;
      }

      setControlsDisabled(false);
      updateModeButtons();
      renderFullInfo();

      virtualScroll = document.createElement('div');
      virtualScroll.className = 'virtual-scroll';
      virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

      virtualSpacer = document.createElement('div');
      virtualSpacer.className = 'virtual-spacer';
      virtualSpacer.style.height = String(getVirtualTotalHeight(full.totalRows)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      virtualScroll.append(virtualSpacer);
      content.replaceChildren(virtualScroll);

      requestVisibleRows();
    }

    function renderFullInfo() {
      if (!full) {
        return;
      }

      fileSize.textContent = full.fileSize;
      lineCount.textContent = full.lineCount === null ? 'Counting...' : formatInteger(full.lineCount);
      rowsInput.value = String(full.maxLines);
      lastSubmittedMaxLines = rowsInput.value;
      modified.textContent = full.lastModified;

      if (full.maxLines === 0) {
        previewStatus.textContent = 'Virtual full-file view';
        return;
      }

      if (full.lineCount === null) {
        previewStatus.textContent = 'Showing first ' + formatInteger(full.totalRows) + ' lines';
        return;
      }

      if (full.totalRows >= full.lineCount) {
        previewStatus.textContent = 'Showing all ' + formatInteger(full.lineCount) + ' lines';
        return;
      }

      previewStatus.textContent =
        'Showing first ' + formatInteger(full.totalRows) + ' of ' + formatInteger(full.lineCount) + ' lines';
    }

    function scheduleVisibleRowsRequest() {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        if (viewState === 'limitedVirtual') {
          requestLimitedVisibleRows();
          return;
        }

        requestVisibleRows();
      });
    }

    function requestVisibleRows() {
      if (!full || !virtualScroll) {
        return;
      }

      const start = Math.max(0, getIndexAtScrollOffset(virtualScroll.scrollTop, full.totalRows) - OVERSCAN);
      const end = Math.min(
        full.totalRows,
        getIndexAtScrollOffset(virtualScroll.scrollTop + virtualScroll.clientHeight, full.totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      const requestId = 'rows-' + String(++latestRequestId);
      pendingRequestId = requestId;

      vscode.postMessage({
        type: 'fetchRows',
        requestId,
        start,
        count,
        mode
      });
    }

    function requestLimitedVisibleRows() {
      if (!data || !virtualScroll) {
        return;
      }

      const totalRows = data.preview.entries.length;
      const start = Math.max(0, getIndexAtScrollOffset(virtualScroll.scrollTop, totalRows) - OVERSCAN);
      const end = Math.min(
        totalRows,
        getIndexAtScrollOffset(virtualScroll.scrollTop + virtualScroll.clientHeight, totalRows) + OVERSCAN + 1
      );
      const count = Math.max(0, end - start);
      renderLimitedVirtualRows(start, count);
    }

    function renderLimitedVirtualRows(start, count) {
      if (!virtualRows || !virtualSpacer || !data) {
        return;
      }

      const totalRows = data.preview.entries.length;
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      virtualSpacer.style.height = String(getVirtualTotalHeight(totalRows)) + 'px';
      virtualRows.style.transform = 'translateY(' + String(getVirtualOffset(start)) + 'px)';
      virtualRows.style.setProperty('--row-height', String(getEstimatedRowHeight()) + 'px');

      const fragment = document.createDocumentFragment();
      for (let index = start; index < start + count; index += 1) {
        const entry = data.preview.entries[index];
        if (entry) {
          fragment.append(renderEntry(entry, mode, true, index));
        }
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows();
    }

    function renderVirtualRows(start, entries, totalRows, rowMode) {
      if (!virtualRows || !virtualSpacer || !full) {
        return;
      }

      full.totalRows = totalRows;
      currentVirtualStart = start;
      currentVirtualTotalRows = totalRows;
      virtualSpacer.style.height = String(getVirtualTotalHeight(totalRows)) + 'px';
      virtualRows.style.transform = 'translateY(' + String(getVirtualOffset(start)) + 'px)';
      virtualRows.style.setProperty('--row-height', String(getEstimatedRowHeight(rowMode)) + 'px');

      const fragment = document.createDocumentFragment();
      for (let index = 0; index < entries.length; index += 1) {
        fragment.append(renderEntry(entries[index], rowMode, true, start + index));
      }
      virtualRows.replaceChildren(fragment);
      measureRenderedRows(rowMode);
    }

    function renderEntry(entry, rowMode, virtualized, rowIndex) {
      const row = document.createElement('section');
      row.className = entry.kind === 'error' ? 'entry error' : 'entry';
      if (virtualized) {
        row.classList.add('virtual-row');
        row.dataset.index = String(rowIndex);
      }
      if (rowMode === 'rawLine') {
        row.classList.add('raw-line');
      }

      const line = document.createElement('div');
      line.className = 'line-number';
      line.textContent = String(entry.lineNumber);

      const body = document.createElement('div');
      body.className = 'line-body';

      if (entry.kind === 'error' && rowMode === 'pretty') {
        const error = document.createElement('p');
        error.className = 'parse-error';
        error.textContent = 'Invalid JSON: ' + entry.error;
        const raw = document.createElement('pre');
        appendHighlightedJson(raw, entry.raw);
        body.append(error, raw);
      } else {
        const rendered = document.createElement('pre');
        appendHighlightedJson(rendered, rowMode === 'pretty' ? entry.formatted : entry.raw);
        body.append(rendered);
      }

      row.append(line, body);
      return row;
    }

    function appendHighlightedJson(target, value) {
      target.replaceChildren();

      let index = 0;
      while (index < value.length) {
        const char = value.charAt(index);

        if (char === '"') {
          const end = findStringEnd(value, index);
          const token = value.slice(index, end);
          appendToken(target, token, isObjectKey(value, end) ? 'json-token key' : 'json-token string');
          index = end;
          continue;
        }

        const number = readNumber(value, index);
        if (number) {
          appendToken(target, number, 'json-token number');
          index += number.length;
          continue;
        }

        if (readKeyword(value, index, 'true')) {
          appendToken(target, 'true', 'json-token boolean');
          index += 4;
          continue;
        }

        if (readKeyword(value, index, 'false')) {
          appendToken(target, 'false', 'json-token boolean');
          index += 5;
          continue;
        }

        if (readKeyword(value, index, 'null')) {
          appendToken(target, 'null', 'json-token null');
          index += 4;
          continue;
        }

        if ('{}[]:,'.includes(char)) {
          appendToken(target, char, 'json-token punctuation');
          index += 1;
          continue;
        }

        appendToken(target, char, '');
        index += 1;
      }
    }

    function appendToken(target, text, className) {
      if (!text) {
        return;
      }

      if (!className) {
        target.append(document.createTextNode(text));
        return;
      }

      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      target.append(span);
    }

    function findStringEnd(value, start) {
      let escaped = false;
      for (let index = start + 1; index < value.length; index += 1) {
        const char = value.charAt(index);

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\\\') {
          escaped = true;
          continue;
        }

        if (char === '"') {
          return index + 1;
        }
      }

      return value.length;
    }

    function isObjectKey(value, stringEnd) {
      let index = stringEnd;
      while (index < value.length && /\\s/.test(value.charAt(index))) {
        index += 1;
      }

      return value.charAt(index) === ':';
    }

    function readNumber(value, start) {
      const match = value.slice(start).match(/^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?/);
      if (!match) {
        return '';
      }

      const token = match[0];
      return isTokenBoundary(value.charAt(start + token.length)) ? token : '';
    }

    function readKeyword(value, start, keyword) {
      if (!value.startsWith(keyword, start)) {
        return false;
      }

      return isTokenBoundary(value.charAt(start + keyword.length));
    }

    function isTokenBoundary(char) {
      return !char || !/[A-Za-z0-9_$]/.test(char);
    }

    function getEstimatedRowHeight(rowMode = mode) {
      if (rowMode === 'pretty') {
        return PRETTY_ROW_HEIGHT;
      }

      if (rowMode === 'wrappedRaw') {
        return WRAPPED_RAW_ROW_HEIGHT;
      }

      return RAW_ROW_HEIGHT;
    }

    function getVirtualTotalHeight(totalRows, rowMode = mode) {
      const estimatedRowHeight = getEstimatedRowHeight(rowMode);
      let total = totalRows * estimatedRowHeight;
      for (const [index, height] of measuredRowHeights) {
        if (index >= 0 && index < totalRows) {
          total += height - estimatedRowHeight;
        }
      }

      return Math.max(0, total);
    }

    function getVirtualOffset(index, rowMode = mode) {
      const estimatedRowHeight = getEstimatedRowHeight(rowMode);
      let offset = index * estimatedRowHeight;
      for (const [measuredIndex, height] of measuredRowHeights) {
        if (measuredIndex >= 0 && measuredIndex < index) {
          offset += height - estimatedRowHeight;
        }
      }

      return Math.max(0, offset);
    }

    function getIndexAtScrollOffset(scrollOffset, totalRows, rowMode = mode) {
      if (totalRows <= 0) {
        return 0;
      }

      let low = 0;
      let high = totalRows - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const nextOffset = getVirtualOffset(middle + 1, rowMode);
        if (nextOffset <= scrollOffset) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      return low;
    }

    function measureRenderedRows(rowMode = mode) {
      if (!virtualRows || !virtualSpacer) {
        return;
      }

      let changed = false;
      for (const row of virtualRows.children) {
        const index = Number(row.dataset.index);
        if (!Number.isInteger(index)) {
          continue;
        }

        const styles = getComputedStyle(row);
        const marginTop = Number.parseFloat(styles.marginTop) || 0;
        const marginBottom = Number.parseFloat(styles.marginBottom) || 0;
        const measuredHeight = row.getBoundingClientRect().height + marginTop + marginBottom;
        const previousHeight = measuredRowHeights.get(index);
        if (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1) {
          measuredRowHeights.set(index, measuredHeight);
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      virtualSpacer.style.height = String(getVirtualTotalHeight(currentVirtualTotalRows, rowMode)) + 'px';
      virtualRows.style.transform = 'translateY(' + String(getVirtualOffset(currentVirtualStart, rowMode)) + 'px)';
    }

    function resetVirtualMeasurements() {
      measuredRowHeights = new Map();
      currentVirtualStart = 0;
      currentVirtualTotalRows = 0;
    }

    function updateModeButtons() {
      for (const button of modeButtons) {
        button.setAttribute('aria-pressed', button.dataset.mode === mode ? 'true' : 'false');
      }
    }

    function setControlsDisabled(disabled) {
      for (const button of modeButtons) {
        button.disabled = disabled;
      }
      rawContentsButton.disabled = disabled;
      rowsInput.disabled = disabled;
    }

    function submitMaxLines() {
      if (rowsInput.disabled) {
        return;
      }

      const rawValue = rowsInput.value.trim();
      if (rawValue === '') {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 0) {
        showRowsError('Rows must be 0 or a positive whole number.');
        return;
      }

      const nextValue = String(value);
      if (nextValue === lastSubmittedMaxLines) {
        return;
      }

      lastSubmittedMaxLines = nextValue;
      clearRowsError();
      vscode.postMessage({
        type: 'updateMaxLines',
        value
      });
    }

    function showRowsError(message) {
      rowsInput.classList.add('invalid');
      rowsError.textContent = message;
    }

    function clearRowsError() {
      rowsInput.classList.remove('invalid');
      rowsError.textContent = '';
    }

    function status(message) {
      const element = document.createElement('p');
      element.className = 'status';
      element.textContent = message;
      return element;
    }

    function textSpan(message) {
      const element = document.createElement('span');
      element.textContent = message;
      return element;
    }

    function formatPercent(value) {
      return Math.max(0, Math.min(100, value)).toFixed(1) + '%';
    }

    function formatBytes(bytes) {
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

      return unitIndex === 0 ? String(bytes) + ' B' : value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
    }

    function formatInteger(value) {
      if (!Number.isFinite(value)) {
        return String(value);
      }

      return Math.trunc(value).toLocaleString('en-US');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
