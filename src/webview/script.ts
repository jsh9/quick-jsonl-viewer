import { INDEXED_PREVIEW_LINE_THRESHOLD } from '../jsonl';

export function getWebviewScript(): string {
  return /* javascript */ `    const vscode = acquireVsCodeApi();
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
    // Cap the physical scrollbar because Chromium loses precision with very
    // tall elements; logical offsets below still cover every indexed row.
    const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;
    const MAX_MEASURED_ROW_HEIGHTS = 512;

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

    content.focus({ preventScroll: true });

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
      virtualSpacer.style.height = String(getVirtualSpacerHeight(data.preview.entries.length)) + 'px';

      virtualRows = document.createElement('div');
      virtualRows.className = 'virtual-rows';
      virtualSpacer.append(virtualRows);
      virtualScroll.append(virtualSpacer);
      content.replaceChildren(virtualScroll);

      requestLimitedVisibleRows();
    }

    function renderLimitedInfo() {
      fileSize.textContent = data.fileSize;
      setLineCountText(data.lineCountState, data.lineCount, data.lineCountProgress);
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
      virtualSpacer.style.height = String(getVirtualSpacerHeight(full.totalRows)) + 'px';

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
      setLineCountText(full.lineCountState, full.lineCount, full.lineCountProgress);
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

    function withLineCountState(payload) {
      // Store count state with the payload so failures survive rerenders
      // triggered by mode changes while the numeric count remains nullable.
      return {
        ...payload,
        lineCountState: payload.lineCount === null ? 'counting' : 'ready',
        lineCountProgress: null
      };
    }

    function setLineCountText(state, value, progress) {
      if (state === 'unavailable') {
        lineCount.textContent = 'Unavailable';
        return;
      }

      if (state === 'ready') {
        lineCount.textContent = formatInteger(value);
        return;
      }

      lineCount.textContent = progress ? 'Counting ' + formatPercent(progress.percent) : 'Counting...';
    }

    function normalizeLineCountProgress(payload) {
      if (!payload || typeof payload.percent !== 'number' || !Number.isFinite(payload.percent)) {
        return null;
      }

      return {
        percent: payload.percent,
        // Keep the current count in state for future UI use; the top bar only
        // shows percent today so long scans do not look stuck.
        lineCount: typeof payload.lineCount === 'number' ? payload.lineCount : null
      };
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
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, full.totalRows) - OVERSCAN);
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

    function requestLimitedVisibleRows() {
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
      const start = Math.max(0, getIndexAtScrollOffset(logicalScrollTop, totalRows) - OVERSCAN);
      const end = Math.min(
        totalRows,
        getIndexAtScrollOffset(logicalScrollBottom, totalRows) + OVERSCAN + 1
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
      pruneMeasuredRowHeights(start, count);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start), totalRows, virtualScroll.clientHeight)) +
        'px)';
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
      pruneMeasuredRowHeights(start, entries.length);
      virtualSpacer.style.height = String(getVirtualSpacerHeight(totalRows, rowMode)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(logicalToPhysicalOffset(getVirtualOffset(start, rowMode), totalRows, virtualScroll.clientHeight, rowMode)) +
        'px)';
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

    function getVirtualSpacerHeight(totalRows, rowMode = mode) {
      return Math.min(getVirtualTotalHeight(totalRows, rowMode), MAX_VIRTUAL_SCROLL_HEIGHT);
    }

    function scrollToLogicalOffset(scrollOffset, totalRows, viewportHeight, rowMode = mode) {
      // Convert the capped physical scrollbar coordinate back into the full
      // logical row space so row lookup still reaches the end of huge files.
      const logicalHeight = getVirtualTotalHeight(totalRows, rowMode);
      const physicalHeight = getVirtualSpacerHeight(totalRows, rowMode);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      // With no scrollable range, preserve viewport-bottom offsets so short
      // virtualized files still request every row that fits onscreen.
      if (logicalMax === 0 || physicalMax === 0) {
        return Math.max(0, Math.min(logicalHeight, scrollOffset));
      }

      return Math.max(0, Math.min(logicalMax, (scrollOffset / physicalMax) * logicalMax));
    }

    function getLogicalViewportBottom(logicalScrollTop, totalRows, viewportHeight, rowMode = mode) {
      // Scroll-top clamps to logicalMax, but viewport bottom clamps to the
      // full logical height so the last visible rows remain requestable.
      return Math.max(
        0,
        Math.min(getVirtualTotalHeight(totalRows, rowMode), logicalScrollTop + viewportHeight)
      );
    }

    function logicalToPhysicalOffset(logicalOffset, totalRows, viewportHeight, rowMode = mode) {
      // Rendered rows are positioned inside the capped spacer, so logical row
      // offsets must be compressed to the same physical coordinate system.
      const logicalHeight = getVirtualTotalHeight(totalRows, rowMode);
      const physicalHeight = getVirtualSpacerHeight(totalRows, rowMode);
      const logicalMax = Math.max(0, logicalHeight - viewportHeight);
      const physicalMax = Math.max(0, physicalHeight - viewportHeight);

      if (logicalMax === 0 || physicalMax === 0 || physicalHeight === logicalHeight) {
        return logicalOffset;
      }

      return Math.max(0, Math.min(physicalMax, (logicalOffset / logicalMax) * physicalMax));
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

      pruneMeasuredRowHeights(currentVirtualStart, virtualRows.children.length);

      if (!changed) {
        return;
      }

      // Measured row heights can change logical height after render; update the
      // capped spacer and transform together to keep rows aligned while scrolling.
      virtualSpacer.style.height = String(getVirtualSpacerHeight(currentVirtualTotalRows, rowMode)) + 'px';
      virtualRows.style.transform =
        'translateY(' +
        String(
          logicalToPhysicalOffset(
            getVirtualOffset(currentVirtualStart, rowMode),
            currentVirtualTotalRows,
            virtualScroll.clientHeight,
            rowMode
          )
        ) +
        'px)';
    }

    function resetVirtualMeasurements() {
      measuredRowHeights = new Map();
      currentVirtualStart = 0;
      currentVirtualTotalRows = 0;
    }

    function pruneMeasuredRowHeights(start, count) {
      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      // Retain measurements near the visible window so variable-height rows
      // stay aligned, but cap old measurements to keep every offset lookup
      // bounded during long scrolling sessions.
      const windowStart = Math.max(0, start - OVERSCAN * 4);
      const windowEnd = start + count + OVERSCAN * 4;
      for (const index of measuredRowHeights.keys()) {
        if (index < windowStart || index > windowEnd) {
          measuredRowHeights.delete(index);
        }
      }

      if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
        return;
      }

      for (const index of measuredRowHeights.keys()) {
        if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
          return;
        }

        measuredRowHeights.delete(index);
      }
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

    vscode.postMessage({ type: 'ready' });`;
}
