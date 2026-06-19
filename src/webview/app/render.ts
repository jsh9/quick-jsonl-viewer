import { INDEXED_PREVIEW_LINE_THRESHOLD } from '../../shared/jsonlConstants';
import { formatBytes, formatInteger, formatPercent } from '../lib/format';
import { tokenizeJson } from '../lib/highlight';
import type {
  FullIndexProgress,
  FullIndexState,
  JsonlDataState,
  JsonlEntry,
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
  readonly scheduleVisibleRowsRequest: () => void;
  readonly requestVisibleRows: () => void;
  readonly requestLimitedVisibleRows: () => void;
  readonly updateModeButtons: () => void;
  readonly setControlsDisabled: (disabled: boolean) => void;
  readonly clearRowsError: () => void;
}

export function createRenderer(context: RendererContext): Renderer {
  const vscode = context.vscode;
  const content = context.elements.content;
  const fileSize = context.elements.fileSize;
  const lineCount = context.elements.lineCount;
  const rowsInput = context.elements.rowsInput;
  const modified = context.elements.modified;
  const previewStatus = context.elements.previewStatus;
  const scheduleVisibleRowsRequest = context.scheduleVisibleRowsRequest;
  const requestVisibleRows = context.requestVisibleRows;
  const requestLimitedVisibleRows = context.requestLimitedVisibleRows;
  const updateModeButtons = context.updateModeButtons;
  const setControlsDisabled = context.setControlsDisabled;
  const clearRowsError = context.clearRowsError;
  let mode = context.getMode();

  function setRenderMode(nextMode: RenderMode): void {
    mode = nextMode;
  }

  function renderLoading(): void {
    setControlsDisabled(true);
    fileSize.textContent = 'Loading...';
    lineCount.textContent = 'Counting...';
    rowsInput.value = '';
    context.setLastSubmittedMaxLines('');
    modified.textContent = 'Loading...';
    previewStatus.textContent = '';
    clearRowsError();
    content.replaceChildren(status('Loading JSONL preview...'));
  }

  function renderError(message: string | undefined): void {
    setControlsDisabled(true);
    fileSize.textContent = 'Unavailable';
    lineCount.textContent = 'Unavailable';
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
    rowsInput.value = String(data.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = data.lastModified;

    const loaded = data.preview.loadedLineCount;
    const limit = data.maxLines;
    if (loaded >= limit) {
      previewStatus.textContent =
        'Showing first ' + formatInteger(loaded) + ' lines';
    } else {
      previewStatus.textContent =
        'Showing ' + formatInteger(loaded) + ' loaded lines';
    }
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
    rowsInput.value = String(full.maxLines);
    context.setLastSubmittedMaxLines(rowsInput.value);
    modified.textContent = full.lastModified;

    if (full.maxLines === 0) {
      previewStatus.textContent = 'Virtual full-file view';
      return;
    }

    if (full.lineCount === null) {
      previewStatus.textContent =
        'Showing first ' + formatInteger(full.totalRows) + ' lines';
      return;
    }

    if (full.totalRows >= full.lineCount) {
      previewStatus.textContent =
        'Showing all ' + formatInteger(full.lineCount) + ' lines';
      return;
    }

    previewStatus.textContent =
      'Showing first ' +
      formatInteger(full.totalRows) +
      ' of ' +
      formatInteger(full.lineCount) +
      ' lines';
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
      appendHighlightedJson(
        rendered,
        rowMode === 'pretty' && entry.kind === 'json'
          ? entry.formatted
          : entry.raw
      );
      body.append(rendered);
    }

    row.append(line, body);
    return row;
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
