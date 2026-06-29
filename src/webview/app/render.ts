import { INDEXED_PREVIEW_LINE_THRESHOLD } from '../../shared/jsonlConstants';
import { getCollapsedPreview, getHiddenLineCountText } from '../lib/collapse';
import { formatBytes, formatInteger, formatPercent } from '../lib/format';
import { tokenizeJson } from '../lib/highlight';
import {
  getCollapsedJsonLine,
  getJsonFoldKey,
  getJsonFoldRanges,
  getJsonValueFoldKey,
  getLongJsonStringValueLine,
  type JsonFoldRange
} from '../lib/jsonFolding';
import type {
  FullIndexProgress,
  FullIndexState,
  JsonlDataState,
  JsonlEntry,
  JsonlJsonEntry,
  JsonlOversizedEntry,
  JsonlPreviewProgress,
  LineCountState,
  NormalizedLineCountProgress,
  PreviewLoadPayload,
  RenderMode,
  ViewState,
  WebviewPostMessage
} from '../lib/protocol';
import {
  getEstimatedRowHeight,
  getMeasuredRowHeight,
  getVirtualOffset,
  getVirtualSpacerHeight,
  getVirtualWindow,
  logicalToPhysicalOffset,
  pruneMeasuredRowHeights,
  setMeasuredRowHeight,
  setVirtualWindow
} from '../lib/virtualScroll';
import { status, textSpan, type WebviewElements } from './dom';

export interface VscodeApi {
  postMessage(message: WebviewPostMessage): void;
}

export interface Renderer {
  readonly setRenderMode: (nextMode: RenderMode) => void;
  readonly setLineCountText: (
    state: LineCountState,
    value: number | null,
    progress?: NormalizedLineCountProgress | null
  ) => void;
  readonly renderLoading: () => void;
  readonly renderError: (message: string | undefined) => void;
  readonly renderCancelled: () => void;
  readonly renderPreviewLoading: () => void;
  readonly renderLimited: () => void;
  readonly renderLimitedInfo: () => void;
  readonly renderFullIndexing: () => void;
  readonly renderFullViewer: () => void;
  readonly renderFullInfo: () => void;
  readonly renderLimitedVirtualRows: (start: number, count: number) => void;
  readonly renderVirtualRows: (
    start: number,
    entries: JsonlEntry[],
    totalRows: number,
    rowMode: RenderMode
  ) => void;
}

export interface RendererContext {
  readonly vscode: VscodeApi;
  readonly elements: WebviewElements;
  readonly getMode: () => RenderMode;
  readonly getData: () => JsonlDataState | null;
  readonly getFull: () => FullIndexState | null;
  readonly getFullProgress: () => FullIndexProgress | null;
  readonly getPreviewLoad: () => PreviewLoadPayload | null;
  readonly getPreviewProgress: () => JsonlPreviewProgress | null;
  readonly getVirtualScroll: () => HTMLDivElement | null;
  readonly getVirtualSpacer: () => HTMLDivElement | null;
  readonly getVirtualRows: () => HTMLDivElement | null;
  readonly setVirtualElements: (
    virtualScroll: HTMLDivElement | null,
    virtualSpacer: HTMLDivElement | null,
    virtualRows: HTMLDivElement | null
  ) => void;
  readonly setViewState: (state: ViewState) => void;
  readonly setLastSubmittedMaxLines: (value: string) => void;
  readonly setLastSubmittedStartLine: (value: string) => void;
  readonly scheduleVisibleRowsRequest: () => void;
  readonly requestVisibleRows: () => void;
  readonly requestLimitedVisibleRows: () => void;
  readonly updateModeButtons: () => void;
  // Refresh enablement depends on app-owned preference and view state, so
  // renderers call back after changing disabled state instead of duplicating it.
  readonly syncRefreshButtonState: () => void;
  readonly setControlsDisabled: (disabled: boolean) => void;
  readonly clearRowsError: () => void;
}

export function createRenderer(context: RendererContext): Renderer {
  const vscode = context.vscode;
  const content = context.elements.content;
  const fileSize = context.elements.fileSize;
  const lineCount = context.elements.lineCount;
  const startInput = context.elements.startInput;
  const rowsInput = context.elements.rowsInput;
  const modified = context.elements.modified;
  const previewStatus = context.elements.previewStatus;
  const scheduleVisibleRowsRequest = context.scheduleVisibleRowsRequest;
  const requestVisibleRows = context.requestVisibleRows;
  const requestLimitedVisibleRows = context.requestLimitedVisibleRows;
  const updateModeButtons = context.updateModeButtons;
  const syncRefreshButtonState = context.syncRefreshButtonState;
  const setControlsDisabled = context.setControlsDisabled;
  const clearRowsError = context.clearRowsError;
  const collapsedPrettyLines = new Set<number>();
  const collapsedJsonBlocks = new Set<string>();
  let mode = context.getMode();

  function setRenderMode(nextMode: RenderMode): void {
    mode = nextMode;
  }

  function renderLoading(): void {
    collapsedPrettyLines.clear();
    collapsedJsonBlocks.clear();
    setControlsDisabled(true);
    fileSize.textContent = 'Loading...';
    lineCount.textContent = 'Counting...';
    startInput.value = '';
    context.setLastSubmittedStartLine('');
    rowsInput.value = '';
    context.setLastSubmittedMaxLines('');
    modified.textContent = 'Loading...';
    previewStatus.textContent = '';
    clearRowsError();
    content.replaceChildren(status('Loading JSONL preview...'));
  }

  function renderError(message: string | undefined): void {
    collapsedPrettyLines.clear();
    collapsedJsonBlocks.clear();
    setControlsDisabled(true);
    syncRefreshButtonState();
    fileSize.textContent = 'Unavailable';
    lineCount.textContent = 'Unavailable';
    startInput.value = '';
    context.setLastSubmittedStartLine('');
    rowsInput.value = '';
    context.setLastSubmittedMaxLines('');
    modified.textContent = 'Unavailable';
    previewStatus.textContent = '';
    clearRowsError();
    const panel = document.createElement('div');
    panel.className = 'error-panel';
    panel.textContent = message || 'Unable to load JSONL file.';
    content.replaceChildren(panel);
  }

  function renderCancelled(): void {
    setControlsDisabled(true);
    syncRefreshButtonState();
    previewStatus.textContent = 'Loading cancelled';
    content.replaceChildren(
      status(
        'Loading was cancelled. Change settings or reopen the file to start again.'
      )
    );
  }

  function renderPreviewLoading(): void {
    const previewLoad = context.getPreviewLoad();
    const previewProgress = context.getPreviewProgress();
    if (!previewLoad || !previewProgress) {
      renderLoading();
      return;
    }

    setControlsDisabled(true);
    fileSize.textContent = previewLoad.fileSize;
    lineCount.textContent = 'Counting...';
    startInput.value = String(previewLoad.startLine);
    context.setLastSubmittedStartLine(startInput.value);
    rowsInput.value = String(previewLoad.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = previewLoad.lastModified;
    previewStatus.textContent =
      'Loading preview ' + formatPercent(previewProgress.percent);

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
      textSpan(
        formatInteger(previewProgress.loadedLineCount) +
          ' / ' +
          formatInteger(previewProgress.displayLimit) +
          ' rows loaded'
      )
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

  function renderLimited(): void {
    const data = context.getData();
    if (!data) {
      renderLoading();
      return;
    }

    setControlsDisabled(false);
    updateModeButtons();
    renderLimitedInfo();

    if (data.preview.entries.length >= INDEXED_PREVIEW_LINE_THRESHOLD) {
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

  function renderLimitedVirtualViewer(): void {
    const data = context.getData();
    if (!data) {
      renderLoading();
      return;
    }

    context.setViewState('limitedVirtual');
    const virtualScroll = document.createElement('div');
    virtualScroll.className = 'virtual-scroll';
    virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

    const virtualSpacer = document.createElement('div');
    virtualSpacer.className = 'virtual-spacer';
    virtualSpacer.style.height =
      String(getVirtualSpacerHeight(data.preview.entries.length)) + 'px';

    const virtualRows = document.createElement('div');
    virtualRows.className = 'virtual-rows';
    virtualSpacer.append(virtualRows);
    virtualScroll.append(virtualSpacer);
    context.setVirtualElements(virtualScroll, virtualSpacer, virtualRows);
    content.replaceChildren(virtualScroll);

    requestLimitedVisibleRows();
  }

  function renderLimitedInfo(): void {
    const data = context.getData();
    if (!data) {
      return;
    }

    fileSize.textContent = data.fileSize;
    setLineCountText(
      data.lineCountState,
      data.lineCount,
      data.lineCountProgress
    );
    startInput.value = String(data.startLine);
    context.setLastSubmittedStartLine(startInput.value);
    rowsInput.value = String(data.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = data.lastModified;

    previewStatus.textContent = getVisibleRangeLabel(
      data.startLine,
      data.preview.loadedLineCount
    );
  }

  function renderFullIndexing(): void {
    const full = context.getFull();
    const fullProgress = context.getFullProgress();
    if (!full || !fullProgress) {
      renderLoading();
      return;
    }

    setControlsDisabled(true);
    fileSize.textContent = full.fileSize;
    lineCount.textContent = 'Indexing...';
    startInput.value = String(full.startLine);
    context.setLastSubmittedStartLine(startInput.value);
    rowsInput.value = String(full.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = full.lastModified;
    const indexingLabel =
      full.maxLines === 0 ? 'Indexing full file' : 'Preparing indexed preview';
    previewStatus.textContent =
      indexingLabel + ' ' + formatPercent(fullProgress.percent);

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
      textSpan(
        formatBytes(fullProgress.bytesRead) +
          ' / ' +
          formatBytes(fullProgress.totalBytes)
      ),
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

  function renderFullViewer(): void {
    const full = context.getFull();
    if (!full) {
      renderLoading();
      return;
    }

    setControlsDisabled(false);
    updateModeButtons();
    renderFullInfo();

    const virtualScroll = document.createElement('div');
    virtualScroll.className = 'virtual-scroll';
    virtualScroll.addEventListener('scroll', scheduleVisibleRowsRequest);

    const virtualSpacer = document.createElement('div');
    virtualSpacer.className = 'virtual-spacer';
    virtualSpacer.style.height =
      String(getVirtualSpacerHeight(full.totalRows)) + 'px';

    const virtualRows = document.createElement('div');
    virtualRows.className = 'virtual-rows';
    virtualSpacer.append(virtualRows);
    virtualScroll.append(virtualSpacer);
    context.setVirtualElements(virtualScroll, virtualSpacer, virtualRows);
    content.replaceChildren(virtualScroll);

    requestVisibleRows();
  }

  function renderFullInfo(): void {
    const full = context.getFull();
    if (!full) {
      return;
    }

    fileSize.textContent = full.fileSize;
    setLineCountText(
      full.lineCountState,
      full.lineCount,
      full.lineCountProgress
    );
    startInput.value = String(full.startLine);
    context.setLastSubmittedStartLine(startInput.value);
    rowsInput.value = String(full.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = full.lastModified;

    if (full.totalRows <= 0) {
      previewStatus.textContent =
        'No lines loaded from line ' + formatInteger(full.startLine);
      return;
    }

    if (full.maxLines === 0) {
      previewStatus.textContent =
        full.startLine === 1
          ? 'Virtual full-file view'
          : 'Virtual full-file view from line ' + formatInteger(full.startLine);
      return;
    }

    if (full.lineCount === null) {
      previewStatus.textContent = getVisibleRangeLabel(
        full.startLine,
        full.totalRows
      );
      return;
    }

    if (full.startLine === 1 && full.totalRows >= full.lineCount) {
      previewStatus.textContent =
        'Showing all ' + formatInteger(full.lineCount) + ' lines';
      return;
    }

    previewStatus.textContent =
      getVisibleRangeLabel(full.startLine, full.totalRows) +
      ' of ' +
      formatInteger(full.lineCount);
  }

  function setLineCountText(
    state: LineCountState,
    value: number | null,
    progress?: NormalizedLineCountProgress | null
  ): void {
    if (state === 'unavailable') {
      lineCount.textContent = 'Unavailable';
      return;
    }

    if (state === 'ready') {
      lineCount.textContent = formatInteger(value ?? Number.NaN);
      return;
    }

    lineCount.textContent = progress
      ? 'Counting ' + formatPercent(progress.percent)
      : 'Counting...';
  }

  function getVisibleRangeLabel(startLine: number, loadedLineCount: number) {
    if (loadedLineCount <= 0) {
      return 'No lines loaded from line ' + formatInteger(startLine);
    }

    return (
      'Showing lines ' +
      formatInteger(startLine) +
      '-' +
      formatInteger(startLine + loadedLineCount - 1)
    );
  }

  function renderLimitedVirtualRows(start: number, count: number): void {
    const virtualRows = context.getVirtualRows();
    const virtualSpacer = context.getVirtualSpacer();
    const virtualScroll = context.getVirtualScroll();
    const data = context.getData();
    if (!virtualRows || !virtualSpacer || !virtualScroll || !data) {
      return;
    }

    const totalRows = data.preview.entries.length;
    setVirtualWindow(start, totalRows);
    pruneMeasuredRowHeights(start, count);
    virtualSpacer.style.height =
      String(getVirtualSpacerHeight(totalRows)) + 'px';
    virtualRows.style.transform =
      'translateY(' +
      String(
        logicalToPhysicalOffset(
          getVirtualOffset(start),
          totalRows,
          virtualScroll.clientHeight
        )
      ) +
      'px)';
    virtualRows.style.setProperty(
      '--row-height',
      String(getEstimatedRowHeight()) + 'px'
    );

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

  function renderVirtualRows(
    start: number,
    entries: JsonlEntry[],
    totalRows: number,
    rowMode: RenderMode
  ): void {
    const virtualRows = context.getVirtualRows();
    const virtualSpacer = context.getVirtualSpacer();
    const virtualScroll = context.getVirtualScroll();
    const full = context.getFull();
    if (!virtualRows || !virtualSpacer || !virtualScroll || !full) {
      return;
    }

    full.totalRows = totalRows;
    setVirtualWindow(start, totalRows);
    pruneMeasuredRowHeights(start, entries.length);
    virtualSpacer.style.height =
      String(getVirtualSpacerHeight(totalRows, rowMode)) + 'px';
    virtualRows.style.transform =
      'translateY(' +
      String(
        logicalToPhysicalOffset(
          getVirtualOffset(start, rowMode),
          totalRows,
          virtualScroll.clientHeight,
          rowMode
        )
      ) +
      'px)';
    virtualRows.style.setProperty(
      '--row-height',
      String(getEstimatedRowHeight(rowMode)) + 'px'
    );

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < entries.length; index += 1) {
      fragment.append(
        renderEntry(entries[index], rowMode, true, start + index)
      );
    }
    virtualRows.replaceChildren(fragment);
    measureRenderedRows(rowMode);
  }

  function renderEntry(
    entry: JsonlEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex?: number
  ): HTMLElement {
    const isCollapsible = rowMode === 'pretty' && entry.kind === 'json';
    const isCollapsed =
      isCollapsible && collapsedPrettyLines.has(entry.lineNumber);
    const row = document.createElement('section');
    row.className =
      entry.kind === 'error'
        ? 'entry error'
        : entry.kind === 'oversized'
          ? 'entry oversized'
          : 'entry';
    row.dataset.lineNumber = String(entry.lineNumber);
    if (isCollapsed) {
      row.classList.add('collapsed');
    }
    if (virtualized) {
      row.classList.add('virtual-row');
      row.dataset.index = String(rowIndex);
    }
    if (rowMode === 'rawLine') {
      row.classList.add('raw-line');
    }

    const line = document.createElement('div');
    line.className = 'line-number';
    if (isCollapsible) {
      line.append(
        renderCollapseToggle(entry, rowMode, virtualized, rowIndex, isCollapsed)
      );
    }
    const lineText = document.createElement('span');
    lineText.className = 'line-number-text';
    lineText.textContent = String(entry.lineNumber);
    line.append(lineText);

    const body = document.createElement('div');
    body.className = 'line-body';

    if (entry.kind === 'oversized') {
      body.append(renderOversizedEntry(entry));
    } else if (entry.kind === 'json' && isCollapsed) {
      body.append(renderCollapsedSummary(entry));
    } else if (entry.kind === 'error' && rowMode === 'pretty') {
      const error = document.createElement('p');
      error.className = 'parse-error';
      error.textContent = 'Invalid JSON: ' + entry.error;
      const raw = document.createElement('pre');
      appendHighlightedJson(raw, entry.raw);
      body.append(error, raw);
    } else if (entry.kind === 'json' && rowMode === 'pretty') {
      body.append(renderPrettyJson(entry, rowMode, virtualized, rowIndex));
    } else {
      const rendered = document.createElement('pre');
      appendHighlightedJson(rendered, entry.raw);
      body.append(rendered);
    }

    row.append(line, body);
    return row;
  }

  function renderPrettyJson(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = 'pretty-json';
    const lines = entry.formatted.split('\n');
    const foldRanges = new Map<number, JsonFoldRange>();
    for (const range of getJsonFoldRanges(entry.formatted)) {
      foldRanges.set(range.startLine, range);
    }

    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const range = foldRanges.get(lineIndex);
      const longValue = range
        ? null
        : getLongJsonStringValueLine(lines[lineIndex]);
      const blockFoldKey = getJsonFoldKey(entry.lineNumber, lineIndex);
      const valueFoldKey = getJsonValueFoldKey(entry.lineNumber, lineIndex);
      const isCollapsed = Boolean(
        (range && collapsedJsonBlocks.has(blockFoldKey)) ||
        (longValue && collapsedJsonBlocks.has(valueFoldKey))
      );
      const lineText =
        range && isCollapsed
          ? getCollapsedJsonLine(lines, range)
          : longValue && isCollapsed
            ? longValue.collapsedLine
            : lines[lineIndex];

      container.append(
        renderPrettyJsonLine(
          entry,
          rowMode,
          virtualized,
          rowIndex,
          lineIndex,
          lineText,
          range,
          longValue,
          isCollapsed
        )
      );

      lineIndex = range && isCollapsed ? range.endLine + 1 : lineIndex + 1;
    }

    return container;
  }

  function renderOversizedEntry(entry: JsonlOversizedEntry): HTMLElement {
    const container = document.createElement('div');
    container.className = 'oversized-row';

    const warning = document.createElement('p');
    warning.className = 'oversized-warning';
    warning.textContent =
      'Line skipped: ' +
      formatBytes(entry.byteLength) +
      ' exceeds the ' +
      formatBytes(entry.limitBytes) +
      ' per-row rendering limit.';

    const preview = document.createElement('pre');
    preview.className = 'oversized-preview';
    preview.textContent = entry.preview || 'No preview available.';

    container.append(warning, preview);
    return container;
  }

  function renderPrettyJsonLine(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    lineIndex: number,
    lineText: string,
    range: JsonFoldRange | undefined,
    longValue: ReturnType<typeof getLongJsonStringValueLine>,
    isCollapsed: boolean
  ): HTMLElement {
    const line = document.createElement('div');
    line.className = 'pretty-json-line';
    const leadingSpaces = countLeadingSpaces(lineText);
    const codeText = lineText.slice(leadingSpaces);
    line.append(renderPrettyJsonPrefix(leadingSpaces, getCurrentIndent()));

    if (range) {
      line.append(
        renderJsonFoldToggle(
          entry,
          rowMode,
          virtualized,
          rowIndex,
          lineIndex,
          range,
          isCollapsed
        )
      );
    } else if (longValue) {
      line.append(
        renderJsonValueFoldToggle(
          entry,
          rowMode,
          virtualized,
          rowIndex,
          lineIndex,
          longValue.valueLength,
          isCollapsed
        )
      );
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'json-fold-spacer';
      line.append(spacer);
    }

    const code = document.createElement('pre');
    code.className = 'pretty-json-code';
    appendHighlightedJson(code, codeText);
    line.append(code);
    return line;
  }

  function renderPrettyJsonPrefix(
    leadingSpaces: number,
    indentWidth: number
  ): HTMLSpanElement {
    const prefix = document.createElement('span');
    prefix.className = 'pretty-json-prefix';
    prefix.style.width = String(leadingSpaces) + 'ch';
    prefix.style.setProperty('--json-indent-step', String(indentWidth) + 'ch');
    return prefix;
  }

  function getCurrentIndent(): number {
    const indent = context.getData()?.indent ?? context.getFull()?.indent ?? 2;
    return Number.isInteger(indent) && indent > 0 ? indent : 2;
  }

  function countLeadingSpaces(value: string): number {
    let count = 0;
    while (value.charCodeAt(count) === 32) {
      count += 1;
    }
    return count;
  }

  function renderJsonFoldToggle(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    lineIndex: number,
    range: JsonFoldRange,
    isCollapsed: boolean
  ): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'json-fold-toggle';
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    toggle.setAttribute(
      'aria-label',
      (isCollapsed ? 'Expand' : 'Collapse') +
        ' JSON block on JSONL line ' +
        String(entry.lineNumber) +
        ', pretty-print line ' +
        String(lineIndex + 1)
    );
    toggle.title =
      String(range.hiddenLineCount) +
      (range.hiddenLineCount === 1 ? ' line' : ' lines');
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleJsonBlock(entry, rowMode, virtualized, rowIndex, lineIndex);
    });
    return toggle;
  }

  function renderJsonValueFoldToggle(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    lineIndex: number,
    valueLength: number,
    isCollapsed: boolean
  ): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'json-fold-toggle';
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    toggle.setAttribute(
      'aria-label',
      (isCollapsed ? 'Expand' : 'Collapse') +
        ' long JSON value on JSONL line ' +
        String(entry.lineNumber) +
        ', pretty-print line ' +
        String(lineIndex + 1)
    );
    toggle.title = String(valueLength) + ' chars';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleJsonValue(entry, rowMode, virtualized, rowIndex, lineIndex);
    });
    return toggle;
  }

  function renderCollapseToggle(
    entry: JsonlEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    isCollapsed: boolean
  ): HTMLButtonElement {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'collapse-toggle';
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    toggle.setAttribute(
      'aria-label',
      (isCollapsed ? 'Expand' : 'Collapse') +
        ' JSONL line ' +
        String(entry.lineNumber)
    );
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCollapsedLine(entry, rowMode, virtualized, rowIndex);
    });
    return toggle;
  }

  function toggleCollapsedLine(
    entry: JsonlEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined
  ): void {
    if (collapsedPrettyLines.has(entry.lineNumber)) {
      collapsedPrettyLines.delete(entry.lineNumber);
    } else {
      collapsedPrettyLines.add(entry.lineNumber);
    }

    replaceRenderedEntry(entry, rowMode, virtualized, rowIndex);
  }

  function toggleJsonBlock(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    lineIndex: number
  ): void {
    const foldKey = getJsonFoldKey(entry.lineNumber, lineIndex);
    if (collapsedJsonBlocks.has(foldKey)) {
      collapsedJsonBlocks.delete(foldKey);
    } else {
      collapsedJsonBlocks.add(foldKey);
    }

    replaceRenderedEntry(entry, rowMode, virtualized, rowIndex);
  }

  function toggleJsonValue(
    entry: JsonlJsonEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined,
    lineIndex: number
  ): void {
    const foldKey = getJsonValueFoldKey(entry.lineNumber, lineIndex);
    if (collapsedJsonBlocks.has(foldKey)) {
      collapsedJsonBlocks.delete(foldKey);
    } else {
      collapsedJsonBlocks.add(foldKey);
    }

    replaceRenderedEntry(entry, rowMode, virtualized, rowIndex);
  }

  function replaceRenderedEntry(
    entry: JsonlEntry,
    rowMode: RenderMode,
    virtualized: boolean,
    rowIndex: number | undefined
  ): void {
    const replacement = renderEntry(entry, rowMode, virtualized, rowIndex);
    const current = document.querySelector<HTMLElement>(
      '.entry[data-line-number="' + String(entry.lineNumber) + '"]'
    );
    current?.replaceWith(replacement);

    if (virtualized) {
      measureRenderedRows(rowMode);
      context.scheduleVisibleRowsRequest();
    }
  }

  function renderCollapsedSummary(entry: JsonlJsonEntry): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'collapsed-summary';

    const preview = document.createElement('pre');
    preview.className = 'collapsed-preview';
    preview.textContent = getCollapsedPreview(entry.raw);

    const meta = document.createElement('span');
    meta.className = 'collapsed-meta';
    meta.textContent = getHiddenLineCountText(entry.formatted);

    summary.append(preview, meta);
    return summary;
  }

  function appendHighlightedJson(target: HTMLElement, value: string): void {
    target.replaceChildren();

    for (const token of tokenizeJson(value)) {
      appendToken(target, token.text, token.className);
    }
  }

  function appendToken(
    target: HTMLElement,
    text: string,
    className: string
  ): void {
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

  function measureRenderedRows(rowMode = mode): void {
    const virtualRows = context.getVirtualRows();
    const virtualSpacer = context.getVirtualSpacer();
    const virtualScroll = context.getVirtualScroll();
    if (!virtualRows || !virtualSpacer || !virtualScroll) {
      return;
    }

    let changed = false;
    for (const row of virtualRows.children) {
      const index = Number((row as HTMLElement).dataset.index);
      if (!Number.isInteger(index)) {
        continue;
      }

      const styles = getComputedStyle(row);
      const marginTop = Number.parseFloat(styles.marginTop) || 0;
      const marginBottom = Number.parseFloat(styles.marginBottom) || 0;
      const measuredHeight =
        row.getBoundingClientRect().height + marginTop + marginBottom;
      const previousHeight = getMeasuredRowHeight(index);
      if (!previousHeight || Math.abs(previousHeight - measuredHeight) > 1) {
        setMeasuredRowHeight(index, measuredHeight);
        changed = true;
      }
    }

    const virtualWindow = getVirtualWindow();
    pruneMeasuredRowHeights(virtualWindow.start, virtualRows.children.length);

    if (!changed) {
      return;
    }

    // Measured row heights can change logical height after render; update the
    // capped spacer and transform together to keep rows aligned while scrolling.
    virtualSpacer.style.height =
      String(getVirtualSpacerHeight(virtualWindow.totalRows, rowMode)) + 'px';
    virtualRows.style.transform =
      'translateY(' +
      String(
        logicalToPhysicalOffset(
          getVirtualOffset(virtualWindow.start, rowMode),
          virtualWindow.totalRows,
          virtualScroll.clientHeight,
          rowMode
        )
      ) +
      'px)';
  }

  return {
    setRenderMode,
    setLineCountText,
    renderLoading,
    renderError,
    renderCancelled,
    renderPreviewLoading,
    renderLimited,
    renderLimitedInfo,
    renderFullIndexing,
    renderFullViewer,
    renderFullInfo,
    renderLimitedVirtualRows,
    renderVirtualRows
  };
}
