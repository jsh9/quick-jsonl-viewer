export type JsonFoldOpenChar = '{' | '[';
export type JsonFoldCloseChar = '}' | ']';
export const LONG_JSON_STRING_VALUE_THRESHOLD = 512;
export const COLLAPSED_JSON_STRING_VALUE_PREVIEW_LENGTH = 160;

export interface JsonFoldRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly openChar: JsonFoldOpenChar;
  readonly closeChar: JsonFoldCloseChar;
  readonly hiddenLineCount: number;
}

export interface JsonLongValueLine {
  readonly collapsedLine: string;
  readonly valueLength: number;
}

interface OpenContainer {
  readonly lineIndex: number;
  readonly openChar: JsonFoldOpenChar;
}

export function getJsonFoldRanges(formatted: string): JsonFoldRange[] {
  const ranges: JsonFoldRange[] = [];
  const stack: OpenContainer[] = [];
  const lines = formatted.split('\n');
  let inString = false;
  let escaped = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const char = line.charAt(charIndex);

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (isOpenChar(char)) {
        stack.push({ lineIndex, openChar: char });
        continue;
      }

      if (isCloseChar(char)) {
        const container = stack.pop();
        if (!container || getCloseChar(container.openChar) !== char) {
          continue;
        }

        if (container.lineIndex !== lineIndex) {
          ranges.push({
            startLine: container.lineIndex,
            endLine: lineIndex,
            openChar: container.openChar,
            closeChar: char,
            hiddenLineCount: lineIndex - container.lineIndex
          });
        }
      }
    }
  }

  return ranges.sort((left, right) => left.startLine - right.startLine);
}

export function getCollapsedJsonLine(
  lines: readonly string[],
  range: JsonFoldRange
): string {
  const openLine = lines[range.startLine] ?? '';
  const closeLine = lines[range.endLine] ?? '';
  const comma = closeLine.trimEnd().endsWith(',') ? ',' : '';
  return openLine.trimEnd() + ' ... ' + range.closeChar + comma;
}

export function getJsonFoldKey(
  jsonlLineNumber: number,
  formattedLineIndex: number
): string {
  return String(jsonlLineNumber) + ':' + String(formattedLineIndex);
}

export function getJsonValueFoldKey(
  jsonlLineNumber: number,
  formattedLineIndex: number
): string {
  return String(jsonlLineNumber) + ':value:' + String(formattedLineIndex);
}

export function getLongJsonStringValueLine(
  line: string,
  threshold = LONG_JSON_STRING_VALUE_THRESHOLD
): JsonLongValueLine | null {
  const match = matchStringValueLine(line);
  if (!match) {
    return null;
  }

  let value: string;
  try {
    value = JSON.parse(match.valueLiteral) as string;
  } catch {
    return null;
  }

  if (value.length <= threshold) {
    return null;
  }

  const hiddenCount = Math.max(
    0,
    value.length - COLLAPSED_JSON_STRING_VALUE_PREVIEW_LENGTH
  );
  const preview =
    value.slice(0, COLLAPSED_JSON_STRING_VALUE_PREVIEW_LENGTH).trimEnd() +
    ' ... (' +
    String(hiddenCount) +
    ' chars hidden)';

  return {
    collapsedLine: match.prefix + JSON.stringify(preview) + match.comma,
    valueLength: value.length
  };
}

function isOpenChar(char: string): char is JsonFoldOpenChar {
  return char === '{' || char === '[';
}

function isCloseChar(char: string): char is JsonFoldCloseChar {
  return char === '}' || char === ']';
}

function getCloseChar(openChar: JsonFoldOpenChar): JsonFoldCloseChar {
  return openChar === '{' ? '}' : ']';
}

function matchStringValueLine(line: string): {
  readonly prefix: string;
  readonly valueLiteral: string;
  readonly comma: string;
} | null {
  const stringLiteral = '"(?:\\\\.|[^"\\\\])*"';
  const objectValuePattern = new RegExp(
    '^(\\s*' + stringLiteral + '\\s*:\\s*)(' + stringLiteral + ')(,?)$'
  );
  const arrayValuePattern = new RegExp('^(\\s*)(' + stringLiteral + ')(,?)$');
  const match = objectValuePattern.exec(line) ?? arrayValuePattern.exec(line);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    valueLiteral: match[2],
    comma: match[3]
  };
}
