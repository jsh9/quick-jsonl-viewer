export const MAX_LINES_ERROR_MESSAGE =
  'Rows must be 0 or a positive whole number.';

export const EXTENSION_MESSAGE_TYPES = [
  'loading',
  'data',
  'lineCount',
  'lineCountProgress',
  'lineCountError',
  'maxLinesError',
  'previewLoadStart',
  'previewLoadProgress',
  'fullIndexStart',
  'fullIndexProgress',
  'fullIndexReady',
  'fullIndexCancelled',
  'rows',
  'error'
] as const;

export const WEBVIEW_POSTED_MESSAGE_TYPES = [
  'ready',
  'rawContents',
  'cancelIndex',
  'fetchRows',
  'updateMaxLines'
] as const;

export type RenderMode = 'pretty' | 'wrappedRaw' | 'rawLine';
export type ViewState =
  | 'loading'
  | 'limited'
  | 'limitedVirtual'
  | 'previewLoading'
  | 'fullIndexing'
  | 'fullReady'
  | 'cancelled'
  | 'error';
export type LineCountState = 'counting' | 'ready' | 'unavailable';

export interface JsonlJsonEntry {
  kind: 'json';
  lineNumber: number;
  raw: string;
  formatted: string;
}

export interface JsonlErrorEntry {
  kind: 'error';
  lineNumber: number;
  raw: string;
  error: string;
}

export type JsonlEntry = JsonlJsonEntry | JsonlErrorEntry;

export interface JsonlPreview {
  entries: JsonlEntry[];
  plainText: string;
  loadedLineCount: number;
  displayLimit: number;
}

export interface LineCountProgress {
  bytesRead?: number;
  totalBytes?: number;
  percent: number;
  lineCount?: number;
}

export interface NormalizedLineCountProgress {
  percent: number;
  lineCount: number | null;
}

export interface JsonlPreviewProgress {
  loadedLineCount: number;
  displayLimit: number;
  percent: number;
}

export interface FullIndexProgress {
  bytesRead: number;
  totalBytes: number;
  percent: number;
  indexedLineCount: number;
}

export interface JsonlMetadataPayload {
  fileName: string;
  fileSize: string;
  lastModified: string;
  maxLines: number;
  indent: number;
}

export interface JsonlDataPayload extends JsonlMetadataPayload {
  lineCount: number | null;
  preview: JsonlPreview;
}

export interface FullIndexStartPayload extends JsonlMetadataPayload {
  totalBytes: number;
}

export interface PreviewLoadPayload extends JsonlMetadataPayload {
  displayLimit: number;
}

export interface FullIndexReadyPayload extends JsonlMetadataPayload {
  lineCount: number | null;
  totalRows: number;
  isComplete: boolean;
}

export interface LineCountFields {
  lineCountState: LineCountState;
  lineCountProgress: NormalizedLineCountProgress | null;
}

export type JsonlDataState = JsonlDataPayload & LineCountFields;
export type FullIndexState = FullIndexReadyPayload & LineCountFields;

export type ExtensionMessage =
  | { type: 'loading' }
  | { type: 'data'; payload: JsonlDataPayload }
  | { type: 'lineCount'; lineCount: number }
  | { type: 'lineCountProgress'; payload: unknown }
  | { type: 'lineCountError'; message?: string }
  | { type: 'maxLinesError'; message?: string }
  | { type: 'previewLoadStart'; payload: PreviewLoadPayload }
  | { type: 'previewLoadProgress'; payload: JsonlPreviewProgress }
  | { type: 'fullIndexStart'; payload: FullIndexStartPayload }
  | { type: 'fullIndexProgress'; payload: FullIndexProgress }
  | { type: 'fullIndexReady'; payload: FullIndexReadyPayload }
  | { type: 'fullIndexCancelled' }
  | {
      type: 'rows';
      requestId: string;
      mode: RenderMode;
      payload: {
        start: number;
        entries: JsonlEntry[];
        totalLines: number;
      };
    }
  | { type: 'error'; message?: string };

export type WebviewPostMessage =
  | { type: 'ready' }
  | { type: 'rawContents' }
  | { type: 'cancelIndex' }
  | {
      type: 'fetchRows';
      requestId: string;
      start: number;
      count: number;
      mode: RenderMode;
    }
  | { type: 'updateMaxLines'; value: number };

export interface MaxLinesValidationResult {
  ok: boolean;
  message?: string;
  value?: number;
  nextValue?: string;
}

export type MaxLinesSubmission =
  | {
      readonly kind: 'invalid';
      readonly message: string;
    }
  | {
      readonly kind: 'unchanged';
      readonly value: number;
    }
  | {
      readonly kind: 'changed';
      readonly value: number;
      readonly submittedValue: string;
    };

export function withLineCountState<
  TPayload extends { lineCount: number | null }
>(payload: TPayload): TPayload & LineCountFields {
  // Store count state with the payload so failures survive rerenders
  // triggered by mode changes while the numeric count remains nullable.
  return {
    ...payload,
    lineCountState: payload.lineCount === null ? 'counting' : 'ready',
    lineCountProgress: null
  };
}

export function normalizeLineCountProgress(
  payload: unknown
): NormalizedLineCountProgress | null {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as LineCountProgress).percent !== 'number' ||
    !Number.isFinite((payload as LineCountProgress).percent)
  ) {
    return null;
  }

  return {
    percent: (payload as LineCountProgress).percent,
    // Keep the current count in state for future UI use; the top bar only
    // shows percent today so long scans do not look stuck.
    lineCount:
      typeof (payload as LineCountProgress).lineCount === 'number'
        ? ((payload as LineCountProgress).lineCount ?? null)
        : null
  };
}

export function validateMaxLinesInput(
  rawValue: string
): MaxLinesValidationResult {
  if (rawValue === '') {
    return {
      ok: false,
      message: MAX_LINES_ERROR_MESSAGE
    };
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    return {
      ok: false,
      message: MAX_LINES_ERROR_MESSAGE
    };
  }

  return {
    ok: true,
    value,
    nextValue: String(value)
  };
}

export function shouldSubmitMaxLines(
  nextValue: string,
  lastSubmittedMaxLines: string
): boolean {
  return nextValue !== lastSubmittedMaxLines;
}

export function getMaxLinesSubmission(
  rawValue: string,
  lastSubmittedMaxLines: string
): MaxLinesSubmission {
  const result = validateMaxLinesInput(rawValue);
  if (
    !result.ok ||
    result.value === undefined ||
    result.nextValue === undefined
  ) {
    return {
      kind: 'invalid',
      message: result.message ?? MAX_LINES_ERROR_MESSAGE
    };
  }

  if (!shouldSubmitMaxLines(result.nextValue, lastSubmittedMaxLines)) {
    return {
      kind: 'unchanged',
      value: result.value
    };
  }

  return {
    kind: 'changed',
    value: result.value,
    submittedValue: result.nextValue
  };
}
