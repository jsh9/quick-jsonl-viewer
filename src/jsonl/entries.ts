import {
  MAX_RENDERED_ROW_BYTES,
  OVERSIZED_ROW_PREVIEW_BYTES
} from '../shared/jsonlConstants';

export type JsonlEntry = JsonlJsonEntry | JsonlErrorEntry | JsonlOversizedEntry;

export interface JsonlJsonEntry {
  readonly kind: 'json';
  readonly lineNumber: number;
  readonly raw: string;
  readonly formatted: string;
}

export interface JsonlErrorEntry {
  readonly kind: 'error';
  readonly lineNumber: number;
  readonly raw: string;
  readonly error: string;
}

export interface JsonlOversizedEntry {
  readonly kind: 'oversized';
  readonly lineNumber: number;
  readonly byteLength: number;
  readonly limitBytes: number;
  readonly preview: string;
}

export interface FormatJsonlLineOptions {
  readonly byteLength?: number;
  readonly maxRowBytes?: number;
  readonly previewLength?: number;
}

export function formatJsonlLine(
  lineNumber: number,
  raw: string,
  indent: number,
  options: FormatJsonlLineOptions = {}
): JsonlEntry {
  const byteLength = options.byteLength ?? Buffer.byteLength(raw, 'utf8');
  const maxRowBytes = options.maxRowBytes ?? MAX_RENDERED_ROW_BYTES;
  if (byteLength > maxRowBytes) {
    return createOversizedJsonlEntry(lineNumber, byteLength, raw, {
      maxRowBytes,
      previewLength: options.previewLength,
      isPreviewTruncated:
        raw.length > (options.previewLength ?? OVERSIZED_ROW_PREVIEW_BYTES)
    });
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return {
      kind: 'json',
      lineNumber,
      raw,
      formatted: JSON.stringify(parsed, null, indent)
    };
  } catch (error) {
    return {
      kind: 'error',
      lineNumber,
      raw,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function createOversizedJsonlEntry(
  lineNumber: number,
  byteLength: number,
  previewSource: string,
  options: {
    readonly maxRowBytes?: number;
    readonly previewLength?: number;
    readonly isPreviewTruncated?: boolean;
  } = {}
): JsonlOversizedEntry {
  return {
    kind: 'oversized',
    lineNumber,
    byteLength,
    limitBytes: options.maxRowBytes ?? MAX_RENDERED_ROW_BYTES,
    preview: getOversizedRowPreview(
      previewSource,
      options.previewLength,
      options.isPreviewTruncated
    )
  };
}

export function getJsonlEntryPlainText(entry: JsonlEntry): string {
  if (entry.kind === 'oversized') {
    return entry.preview;
  }

  return entry.raw;
}

function getOversizedRowPreview(
  value: string,
  maxLength = OVERSIZED_ROW_PREVIEW_BYTES,
  forceEllipsis = false
): string {
  const preview = value
    .slice(0, Math.max(0, maxLength))
    .replace(/\s+/g, ' ')
    .trim();
  return forceEllipsis || value.length > maxLength ? preview + ' ...' : preview;
}
