import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MEASURED_ROW_HEIGHTS,
  MAX_VIRTUAL_SCROLL_HEIGHT,
  getEstimatedRowHeight,
  getIndexAtScrollOffset,
  getLogicalViewportBottom,
  getMeasuredRowHeight,
  getMeasuredRowHeightCount,
  getMeasuredRowHeightEntries,
  getVirtualOffset,
  getVirtualSpacerHeight,
  getVirtualTotalHeight,
  getVirtualWindow,
  getVisibleRowRange,
  logicalToPhysicalOffset,
  pruneMeasuredRowHeights,
  resetVirtualMeasurements,
  scrollToLogicalOffset,
  setMeasuredRowHeight,
  setVirtualScrollMode,
  setVirtualWindow
} from '../../../src/webview/lib/virtualScroll';

test('webview virtual scroll helpers map logical rows onto capped physical scroll space', () => {
  const measured = new Map([[0, 50]]);

  assert.equal(getEstimatedRowHeight('pretty'), 180);
  assert.equal(getEstimatedRowHeight('wrappedRaw'), 82);
  assert.equal(getEstimatedRowHeight('rawLine'), 46);
  assert.equal(getVirtualTotalHeight(2, 'rawLine', measured), 96);
  assert.equal(
    getVirtualSpacerHeight(1_000_000, 'pretty', new Map()),
    MAX_VIRTUAL_SCROLL_HEIGHT
  );
  assert.equal(scrollToLogicalOffset(80, 1, 100, 'rawLine', new Map()), 46);

  const logicalHeight = getVirtualTotalHeight(1_000_000, 'pretty', new Map());
  const logical = scrollToLogicalOffset(
    MAX_VIRTUAL_SCROLL_HEIGHT,
    1_000_000,
    100,
    'pretty',
    new Map()
  );
  assert.ok(logical <= logicalHeight);
  assert.equal(getLogicalViewportBottom(40, 1, 100, 'rawLine', new Map()), 46);
  assert.equal(
    logicalToPhysicalOffset(100, 10, 100, 'rawLine', new Map()),
    100
  );
  assert.equal(getVirtualOffset(2, 'rawLine', measured), 96);
  assert.equal(getIndexAtScrollOffset(100, 10, 'rawLine', measured), 2);
  assert.deepEqual(getVisibleRowRange(0, 100, 46, 'rawLine', new Map()), {
    start: 0,
    end: 10,
    count: 10
  });
});

test('webview virtual scroll measurement pruning keeps the visible window bounded', () => {
  const measured = new Map<number, number>();
  for (let index = 0; index < 600; index += 1) {
    measured.set(index, 50);
  }

  pruneMeasuredRowHeights(measured, 300, 10);

  assert.ok(measured.size <= MAX_MEASURED_ROW_HEIGHTS);
  assert.equal(measured.has(0), false);
  assert.equal(measured.has(300), true);
});

test('webview virtual scroll state helpers reset mode, windows, and measurements', () => {
  resetVirtualMeasurements();
  setVirtualScrollMode('rawLine');
  assert.equal(getEstimatedRowHeight(), 46);

  setVirtualWindow(12, 34);
  assert.deepEqual(getVirtualWindow(), {
    start: 12,
    totalRows: 34
  });

  setMeasuredRowHeight(2, 60);
  assert.equal(getMeasuredRowHeight(2), 60);
  assert.equal(getMeasuredRowHeightCount(), 1);
  assert.deepEqual(getMeasuredRowHeightEntries(), [[2, 60]]);
  assert.equal(getVirtualTotalHeight(3), 152);

  resetVirtualMeasurements();
  assert.equal(getMeasuredRowHeightCount(), 0);
  assert.deepEqual(getVirtualWindow(), {
    start: 0,
    totalRows: 0
  });
  setVirtualScrollMode('pretty');
});

test('webview virtual scroll helpers cover empty rows, compression, and pruning fallbacks', () => {
  assert.equal(getIndexAtScrollOffset(0, 0, 'pretty', new Map()), 0);
  assert.equal(
    getVirtualTotalHeight(
      -1,
      'rawLine',
      new Map([
        [-1, 100],
        [2, 70]
      ])
    ),
    0
  );

  const compressed = logicalToPhysicalOffset(
    50_000_000,
    1_000_000,
    100,
    'pretty',
    new Map()
  );
  assert.ok(compressed > 0);
  assert.ok(compressed < 50_000_000);

  const small = new Map([[1, 50]]);
  pruneMeasuredRowHeights(small, 0, 1);
  assert.equal(small.size, 1);
  (
    pruneMeasuredRowHeights as unknown as (
      measurements: Map<number, number>,
      start: number
    ) => void
  )(small, 0);

  const large = new Map<number, number>();
  for (let index = 0; index < 1000; index += 1) {
    large.set(index, 50);
  }
  pruneMeasuredRowHeights(large, 500, 1000);
  assert.ok(large.size <= MAX_MEASURED_ROW_HEIGHTS);
  assert.equal(large.has(0), false);

  const allOutsideWindow = new Map<number, number>();
  for (let index = 0; index < 600; index += 1) {
    allOutsideWindow.set(index, 50);
  }
  pruneMeasuredRowHeights(allOutsideWindow, 10_000, 1);
  assert.equal(allOutsideWindow.size, 0);

  class NonDeletingMap extends Map<number, number> {
    public override delete(_key: number): boolean {
      return true;
    }
  }
  const stubbornMeasurements = new NonDeletingMap();
  for (let index = 0; index < 600; index += 1) {
    stubbornMeasurements.set(index, 50);
  }
  pruneMeasuredRowHeights(stubbornMeasurements, 10_000, 1);
  assert.equal(stubbornMeasurements.size, 600);

  resetVirtualMeasurements();
  for (let index = 0; index < 600; index += 1) {
    setMeasuredRowHeight(index, 50);
  }
  pruneMeasuredRowHeights(300, 10);
  assert.ok(getMeasuredRowHeightCount() <= MAX_MEASURED_ROW_HEIGHTS);
  resetVirtualMeasurements();
});
