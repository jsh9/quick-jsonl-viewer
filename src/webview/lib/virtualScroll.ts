import type { RenderMode } from './protocol';

type MeasuredRowHeights = ReadonlyMap<number, number>;

export const OVERSCAN = 8;
export const PRETTY_ROW_HEIGHT = 180;
export const WRAPPED_RAW_ROW_HEIGHT = 82;
export const RAW_ROW_HEIGHT = 46;
// Cap the physical scrollbar because Chromium loses precision with very
// tall elements; logical offsets below still cover every indexed row.
export const MAX_VIRTUAL_SCROLL_HEIGHT = 8000000;
export const MAX_MEASURED_ROW_HEIGHTS = 512;

let mode: RenderMode = 'pretty';
let measuredRowHeights = new Map<number, number>();
let currentVirtualStart = 0;
let currentVirtualTotalRows = 0;

export function setVirtualScrollMode(rowMode: RenderMode): void {
  mode = rowMode;
}

export function setVirtualWindow(start: number, totalRows: number): void {
  currentVirtualStart = start;
  currentVirtualTotalRows = totalRows;
}

export function getVirtualWindow(): {
  readonly start: number;
  readonly totalRows: number;
} {
  return {
    start: currentVirtualStart,
    totalRows: currentVirtualTotalRows
  };
}

export function setMeasuredRowHeight(index: number, height: number): void {
  measuredRowHeights.set(index, height);
}

export function getMeasuredRowHeight(index: number): number | undefined {
  return measuredRowHeights.get(index);
}

export function getMeasuredRowHeightCount(): number {
  return measuredRowHeights.size;
}

export function getMeasuredRowHeightEntries(): Array<
  readonly [number, number]
> {
  return Array.from(measuredRowHeights.entries());
}

export function getEstimatedRowHeight(rowMode = mode): number {
  if (rowMode === 'pretty') {
    return PRETTY_ROW_HEIGHT;
  }

  if (rowMode === 'wrappedRaw') {
    return WRAPPED_RAW_ROW_HEIGHT;
  }

  return RAW_ROW_HEIGHT;
}

export function getVirtualTotalHeight(
  totalRows: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  const estimatedRowHeight = getEstimatedRowHeight(rowMode);
  let total = totalRows * estimatedRowHeight;
  for (const [index, height] of measurements) {
    if (index >= 0 && index < totalRows) {
      total += height - estimatedRowHeight;
    }
  }

  return Math.max(0, total);
}

export function getVirtualSpacerHeight(
  totalRows: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  return Math.min(
    getVirtualTotalHeight(totalRows, rowMode, measurements),
    MAX_VIRTUAL_SCROLL_HEIGHT
  );
}

export function scrollToLogicalOffset(
  scrollOffset: number,
  totalRows: number,
  viewportHeight: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  // Convert the capped physical scrollbar coordinate back into the full
  // logical row space so row lookup still reaches the end of huge files.
  const logicalHeight = getVirtualTotalHeight(totalRows, rowMode, measurements);
  const physicalHeight = getVirtualSpacerHeight(
    totalRows,
    rowMode,
    measurements
  );
  const logicalMax = Math.max(0, logicalHeight - viewportHeight);
  const physicalMax = Math.max(0, physicalHeight - viewportHeight);

  // With no scrollable range, preserve viewport-bottom offsets so short
  // virtualized files still request every row that fits onscreen.
  if (logicalMax === 0 || physicalMax === 0) {
    return Math.max(0, Math.min(logicalHeight, scrollOffset));
  }

  return Math.max(
    0,
    Math.min(logicalMax, (scrollOffset / physicalMax) * logicalMax)
  );
}

export function getLogicalViewportBottom(
  logicalScrollTop: number,
  totalRows: number,
  viewportHeight: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  // Scroll-top clamps to logicalMax, but viewport bottom clamps to the
  // full logical height so the last visible rows remain requestable.
  return Math.max(
    0,
    Math.min(
      getVirtualTotalHeight(totalRows, rowMode, measurements),
      logicalScrollTop + viewportHeight
    )
  );
}

export function logicalToPhysicalOffset(
  logicalOffset: number,
  totalRows: number,
  viewportHeight: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  // Rendered rows are positioned inside the capped spacer, so logical row
  // offsets must be compressed to the same physical coordinate system.
  const logicalHeight = getVirtualTotalHeight(totalRows, rowMode, measurements);
  const physicalHeight = getVirtualSpacerHeight(
    totalRows,
    rowMode,
    measurements
  );
  const logicalMax = Math.max(0, logicalHeight - viewportHeight);
  const physicalMax = Math.max(0, physicalHeight - viewportHeight);

  if (
    logicalMax === 0 ||
    physicalMax === 0 ||
    physicalHeight === logicalHeight
  ) {
    return logicalOffset;
  }

  return Math.max(
    0,
    Math.min(physicalMax, (logicalOffset / logicalMax) * physicalMax)
  );
}

export function getVirtualOffset(
  index: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  const estimatedRowHeight = getEstimatedRowHeight(rowMode);
  let offset = index * estimatedRowHeight;
  for (const [measuredIndex, height] of measurements) {
    if (measuredIndex >= 0 && measuredIndex < index) {
      offset += height - estimatedRowHeight;
    }
  }

  return Math.max(0, offset);
}

export function getIndexAtScrollOffset(
  scrollOffset: number,
  totalRows: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): number {
  if (totalRows <= 0) {
    return 0;
  }

  let low = 0;
  let high = totalRows - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const nextOffset = getVirtualOffset(middle + 1, rowMode, measurements);
    if (nextOffset <= scrollOffset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function getVisibleRowRange(
  scrollOffset: number,
  totalRows: number,
  viewportHeight: number,
  rowMode = mode,
  measurements: MeasuredRowHeights = measuredRowHeights
): { readonly start: number; readonly end: number; readonly count: number } {
  const logicalScrollTop = scrollToLogicalOffset(
    scrollOffset,
    totalRows,
    viewportHeight,
    rowMode,
    measurements
  );
  const logicalScrollBottom = getLogicalViewportBottom(
    logicalScrollTop,
    totalRows,
    viewportHeight,
    rowMode,
    measurements
  );
  const start = Math.max(
    0,
    getIndexAtScrollOffset(logicalScrollTop, totalRows, rowMode, measurements) -
      OVERSCAN
  );
  const end = Math.min(
    totalRows,
    getIndexAtScrollOffset(
      logicalScrollBottom,
      totalRows,
      rowMode,
      measurements
    ) +
      OVERSCAN +
      1
  );

  return {
    start,
    end,
    count: Math.max(0, end - start)
  };
}

export function resetVirtualMeasurements(): void {
  measuredRowHeights = new Map();
  currentVirtualStart = 0;
  currentVirtualTotalRows = 0;
}

export function pruneMeasuredRowHeights(start: number, count: number): void;
export function pruneMeasuredRowHeights(
  measurements: Map<number, number>,
  start: number,
  count: number
): void;
export function pruneMeasuredRowHeights(
  measurementsOrStart: Map<number, number> | number,
  startOrCount: number,
  maybeCount?: number
): void {
  const targetMeasurements =
    measurementsOrStart instanceof Map
      ? measurementsOrStart
      : measuredRowHeights;
  const start =
    measurementsOrStart instanceof Map ? startOrCount : measurementsOrStart;
  const count =
    measurementsOrStart instanceof Map ? (maybeCount ?? 0) : startOrCount;

  if (targetMeasurements.size <= MAX_MEASURED_ROW_HEIGHTS) {
    return;
  }

  // Retain measurements near the visible window so variable-height rows
  // stay aligned, but cap old measurements to keep every offset lookup
  // bounded during long scrolling sessions.
  const windowStart = Math.max(0, start - OVERSCAN * 4);
  const windowEnd = start + count + OVERSCAN * 4;
  for (const index of targetMeasurements.keys()) {
    if (index < windowStart || index > windowEnd) {
      targetMeasurements.delete(index);
    }
  }

  if (targetMeasurements.size <= MAX_MEASURED_ROW_HEIGHTS) {
    return;
  }

  for (const index of targetMeasurements.keys()) {
    if (targetMeasurements.size <= MAX_MEASURED_ROW_HEIGHTS) {
      return;
    }

    targetMeasurements.delete(index);
  }
}
