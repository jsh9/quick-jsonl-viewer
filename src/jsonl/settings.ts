import { INDEXED_PREVIEW_LINE_THRESHOLD } from '../shared/jsonlConstants';

export const DEFAULT_MAX_LINES = 20;
export const DEFAULT_INDENT = 2;
export const DEFAULT_AUTO_REFRESH = true;
export const DEFAULT_START_LINE = 1;
export { INDEXED_PREVIEW_LINE_THRESHOLD } from '../shared/jsonlConstants';

export interface ViewerSettings {
  readonly maxLines: number;
  readonly indent: number;
  readonly autoRefresh: boolean;
  readonly startLine: number;
}

export function normalizeViewerSettings(input: {
  readonly maxLines?: unknown;
  readonly indent?: unknown;
  readonly autoRefresh?: unknown;
  readonly startLine?: unknown;
}): ViewerSettings {
  return {
    maxLines: normalizeInteger(input.maxLines, DEFAULT_MAX_LINES, 0),
    indent: normalizeInteger(input.indent, DEFAULT_INDENT, 1),
    autoRefresh: normalizeBoolean(input.autoRefresh, DEFAULT_AUTO_REFRESH),
    startLine: normalizeInteger(input.startLine, DEFAULT_START_LINE, 1)
  };
}

export function shouldUseIndexedPreview(maxLines: number): boolean {
  return maxLines === 0 || maxLines >= INDEXED_PREVIEW_LINE_THRESHOLD;
}

export function getDisplayRowCount(
  lineCount: number,
  maxLines: number,
  startLine = DEFAULT_START_LINE
): number {
  const availableLines = Math.max(0, lineCount - (startLine - 1));
  return maxLines === 0 ? availableLines : Math.min(availableLines, maxLines);
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    return fallback;
  }

  return value;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
