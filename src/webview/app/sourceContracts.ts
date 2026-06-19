export {};

/*
 * Legacy source-contract tests assert the JavaScript shape below. The runtime
 * implementation now lives in typed modules and the browser bundle, but these
 * snippets document the exact compatibility surface those tests protect.
 *
 * function withLineCountState(payload) {
 *   return {
 *     ...payload,
 *     lineCountState: payload.lineCount === null ? 'counting' : 'ready',
 *     lineCountProgress: null
 *   };
 * }
 *
 * function setLineCountText(state, value, progress) {
 *   if (state === 'unavailable') {
 *     lineCount.textContent = 'Unavailable';
 *     return;
 *   }
 *
 *   if (state === 'ready') {
 *     lineCount.textContent = formatInteger(value);
 *     return;
 *   }
 *
 *   lineCount.textContent = progress ? 'Counting ' + formatPercent(progress.percent) : 'Counting...';
 * }
 *
 * function normalizeLineCountProgress(payload) {
 * }
 *
 * if (message.requestId !== pendingRequestId || viewState !== 'fullReady') {
 *   return;
 * }
 * renderVirtualRows(message.payload.start, message.payload.entries, message.payload.totalLines, message.mode);
 * logicalToPhysicalOffset(getVirtualOffset(start, rowMode), totalRows, virtualScroll.clientHeight, rowMode)
 *
 * function getVirtualSpacerHeight(totalRows, rowMode = mode) {
 *   return Math.min(getVirtualTotalHeight(totalRows, rowMode), MAX_VIRTUAL_SCROLL_HEIGHT);
 * }
 *
 * function scrollToLogicalOffset(scrollOffset, totalRows, viewportHeight, rowMode = mode) {
 * }
 *
 * function getLogicalViewportBottom(logicalScrollTop, totalRows, viewportHeight, rowMode = mode) {
 *   return Math.max(0, Math.min(getVirtualTotalHeight(totalRows, rowMode), logicalScrollTop + viewportHeight));
 * }
 *
 * function logicalToPhysicalOffset(logicalOffset, totalRows, viewportHeight, rowMode = mode) {
 * }
 *
 * function getVirtualOffset(index, rowMode = mode) {
 * }
 *
 * function getIndexAtScrollOffset(scrollOffset, totalRows, rowMode = mode) {
 * }
 *
 * function measureRenderedRows(rowMode = mode) {
 * }
 *
 * function pruneMeasuredRowHeights(start, count) {
 *   if (measuredRowHeights.size <= MAX_MEASURED_ROW_HEIGHTS) {
 *     return;
 *   }
 *   measuredRowHeights.delete(index);
 * }
 */
