import {
  INDEXED_PREVIEW_LINE_THRESHOLD,
  MAX_RENDERED_ROW_BYTES,
  OVERSIZED_ROW_PREVIEW_BYTES
} from '../shared/jsonlConstants';

export const DEFAULT_MAX_LINES = 20;
export const DEFAULT_INDENT = 2;
export const DEFAULT_AUTO_REFRESH = true;
export const DEFAULT_INDENT_GUIDES = true;
export const DEFAULT_START_LINE = 1;
export const DEFAULT_MAX_RENDERED_ROW_BYTES = MAX_RENDERED_ROW_BYTES;
export const DEFAULT_OVERSIZED_ROW_PREVIEW_BYTES = OVERSIZED_ROW_PREVIEW_BYTES;
export {
  INDEXED_PREVIEW_LINE_THRESHOLD,
  MAX_RENDERED_ROW_BYTES,
  OVERSIZED_ROW_PREVIEW_BYTES
} from '../shared/jsonlConstants';

export interface ViewerSettings {
  readonly maxLines: number;
  readonly indent: number;
  readonly autoRefresh: boolean;
  readonly indentGuides: boolean;
  readonly maxRenderedRowBytes: number;
  readonly oversizedRowPreviewBytes: number;
}

export interface ViewerLoadSettings {
  readonly maxLines: number;
  readonly indent: number;
  readonly startLine: number;
  readonly maxRenderedRowBytes: number;
  readonly oversizedRowPreviewBytes: number;
}

export function normalizeViewerSettings(input: {
  readonly maxLines?: unknown;
  readonly indent?: unknown;
  readonly autoRefresh?: unknown;
  readonly indentGuides?: unknown;
  readonly maxRenderedRowBytes?: unknown;
  readonly oversizedRowPreviewBytes?: unknown;
}): ViewerSettings {
  return {
    maxLines: normalizeInteger(input.maxLines, DEFAULT_MAX_LINES, 0),
    indent: normalizeInteger(input.indent, DEFAULT_INDENT, 1),
    autoRefresh: normalizeBoolean(input.autoRefresh, DEFAULT_AUTO_REFRESH),
    indentGuides: normalizeBoolean(input.indentGuides, DEFAULT_INDENT_GUIDES),
    maxRenderedRowBytes: normalizeInteger(
      input.maxRenderedRowBytes,
      DEFAULT_MAX_RENDERED_ROW_BYTES,
      1
    ),
    oversizedRowPreviewBytes: normalizeInteger(
      input.oversizedRowPreviewBytes,
      DEFAULT_OVERSIZED_ROW_PREVIEW_BYTES,
      0
    )
  };
}

export function shouldUseIndexedPreview(maxLines: number): boolean {
  return maxLines === 0 || maxLines >= INDEXED_PREVIEW_LINE_THRESHOLD;
}

export function shouldUseIndexedLoad(
  maxLines: number,
  startLine: number
): boolean {
  // Distant start-line jumps still require a prefix scan. Route them
  // through indexed loading so the UI can report progress and reuse
  // row-offset fetching instead of silently skipping many lines.
  return (
    shouldUseIndexedPreview(maxLines) ||
    startLine > INDEXED_PREVIEW_LINE_THRESHOLD
  );
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
