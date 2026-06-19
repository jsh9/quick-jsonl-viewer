import {
  setControlsDisabled as setDomControlsDisabled,
  type WebviewElements
} from './dom';
import { createRenderer, type VscodeApi } from './render';
import {
  MAX_LINES_ERROR_MESSAGE,
  type ExtensionMessage,
  type FullIndexProgress,
  type FullIndexState,
  type JsonlDataState,
  type JsonlPreviewProgress,
  type PreviewLoadPayload,
  type RenderMode,
  type ViewState,
  normalizeLineCountProgress,
  withLineCountState
} from '../lib/protocol';
import {
  OVERSCAN,
  getIndexAtScrollOffset,
  getLogicalViewportBottom,
  resetVirtualMeasurements,
  scrollToLogicalOffset,
  setVirtualScrollMode
} from '../lib/virtualScroll';

export function createWebviewApp(
  vscode: VscodeApi,
  elements: WebviewElements
): void {
  const content = elements.content;
  const modeButtons = elements.modeButtons;
  const rawContentsButton = elements.rawContentsButton;
  const rowsInput = elements.rowsInput;
  const rowsError = elements.rowsError;

  let mode: RenderMode = 'pretty';
  let viewState: ViewState = 'loading';
  let data: JsonlDataState | null = null;
  let full: FullIndexState | null = null;
  let fullProgress: FullIndexProgress | null = null;
  let previewLoad: PreviewLoadPayload | null = null;
  let previewProgress: JsonlPreviewProgress | null = null;
  let virtualScroll: HTMLDivElement | null = null;
  let virtualSpacer: HTMLDivElement | null = null;
  let virtualRows: HTMLDivElement | null = null;
  let latestRequestId = 0;
  let pendingRequestId = '';
  let animationFrame = 0;
  let lastSubmittedMaxLines = '';

  const renderer = createRenderer({
    vscode,
    elements,
    getMode: () => mode,
    getData: () => data,
    getFull: () => full,
    getFullProgress: () => fullProgress,
    getPreviewLoad: () => previewLoad,
    getPreviewProgress: () => previewProgress,
    getVirtualScroll: () => virtualScroll,
    getVirtualSpacer: () => virtualSpacer,
    getVirtualRows: () => virtualRows,
    setVirtualElements: (
      nextVirtualScroll,
      nextVirtualSpacer,
      nextVirtualRows
    ) => {
      virtualScroll = nextVirtualScroll;
      virtualSpacer = nextVirtualSpacer;
      virtualRows = nextVirtualRows;
    },
    setViewState: (nextViewState) => {
      viewState = nextViewState;
    },
    setLastSubmittedMaxLines: (value) => {
      lastSubmittedMaxLines = value;
    },
    scheduleVisibleRowsRequest,
    requestVisibleRows,
    requestLimitedVisibleRows,
    updateModeButtons,
    setControlsDisabled,
    clearRowsError
  });
  const {
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
  } = renderer;

  setVirtualScrollMode(mode);
  content.focus({ preventScroll: true });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const nextMode = (button.dataset.mode || 'pretty') as RenderMode;
      if (nextMode === mode) {
        return;
      }

      mode = nextMode;
      setVirtualScrollMode(mode);
      renderer.setRenderMode(mode);
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

  window.addEventListener(
    'message',
    (event: MessageEvent<ExtensionMessage>) => {
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
        data = withLineCountState(message.payload);
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
          data.lineCountState = 'ready';
          data.lineCountProgress = null;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.lineCount = message.lineCount;
          full.lineCountState = 'ready';
          full.lineCountProgress = null;
          renderFullInfo();
          return;
        }

        return;
      }

      if (message.type === 'lineCountProgress') {
        const progress = normalizeLineCountProgress(message.payload);
        if (data) {
          data.lineCountState = 'counting';
          data.lineCountProgress = progress;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.lineCountState = 'counting';
          full.lineCountProgress = progress;
          renderFullInfo();
          return;
        }

        setLineCountText('counting', null, progress);
        return;
      }

      if (message.type === 'lineCountError') {
        if (data) {
          data.lineCountState = 'unavailable';
          data.lineCountProgress = null;
          renderLimitedInfo();
          return;
        }

        if (full) {
          full.lineCountState = 'unavailable';
          full.lineCountProgress = null;
          renderFullInfo();
          return;
        }

        setLineCountText('unavailable', null);
        return;
      }

      if (message.type === 'maxLinesError') {
        showRowsError(message.message || MAX_LINES_ERROR_MESSAGE);
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
        full = withLineCountState({
          ...message.payload,
          lineCount: null,
          totalRows: 0,
          isComplete: false
        });
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
        full = withLineCountState(message.payload);
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
        if (
          message.requestId !== pendingRequestId ||
          viewState !== 'fullReady'
        ) {
          return;
        }

        renderVirtualRows(
          message.payload.start,
          message.payload.entries,
          message.payload.totalLines,
          message.mode
        );
        return;
      }

      if (message.type === 'error') {
        data = null;
        full = null;
        viewState = 'error';
        renderError(message.message);
      }
    }
  );

  function scheduleVisibleRowsRequest(): void {
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

  function requestVisibleRows(): void {
    if (!full || !virtualScroll) {
      return;
    }

    const logicalScrollTop = scrollToLogicalOffset(
      virtualScroll.scrollTop,
      full.totalRows,
      virtualScroll.clientHeight
    );
    const logicalScrollBottom = getLogicalViewportBottom(
      logicalScrollTop,
      full.totalRows,
      virtualScroll.clientHeight
    );
    const start = Math.max(
      0,
      getIndexAtScrollOffset(logicalScrollTop, full.totalRows) - OVERSCAN
    );
    const end = Math.min(
      full.totalRows,
      getIndexAtScrollOffset(logicalScrollBottom, full.totalRows) + OVERSCAN + 1
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

  function requestLimitedVisibleRows(): void {
    if (!data || !virtualScroll) {
      return;
    }

    const totalRows = data.preview.entries.length;
    const logicalScrollTop = scrollToLogicalOffset(
      virtualScroll.scrollTop,
      totalRows,
      virtualScroll.clientHeight
    );
    const logicalScrollBottom = getLogicalViewportBottom(
      logicalScrollTop,
      totalRows,
      virtualScroll.clientHeight
    );
    const start = Math.max(
      0,
      getIndexAtScrollOffset(logicalScrollTop, totalRows) - OVERSCAN
    );
    const end = Math.min(
      totalRows,
      getIndexAtScrollOffset(logicalScrollBottom, totalRows) + OVERSCAN + 1
    );
    const count = Math.max(0, end - start);
    renderLimitedVirtualRows(start, count);
  }

  function updateModeButtons(): void {
    for (const button of modeButtons) {
      button.setAttribute(
        'aria-pressed',
        button.dataset.mode === mode ? 'true' : 'false'
      );
    }
  }

  function setControlsDisabled(disabled: boolean): void {
    setDomControlsDisabled(elements, disabled);
  }

  function submitMaxLines(): void {
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

  function showRowsError(message: string): void {
    rowsInput.classList.add('invalid');
    rowsError.textContent = message;
  }

  function clearRowsError(): void {
    rowsInput.classList.remove('invalid');
    rowsError.textContent = '';
  }
}
