export type JsonlEntry = JsonlJsonEntry | JsonlErrorEntry;

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

export function formatJsonlLine(
  lineNumber: number,
  raw: string,
  indent: number
): JsonlEntry {
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
