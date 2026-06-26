export type JsonFoldOpenChar = '{' | '[';
export type JsonFoldCloseChar = '}' | ']';

export interface JsonFoldRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly openChar: JsonFoldOpenChar;
  readonly closeChar: JsonFoldCloseChar;
  readonly hiddenLineCount: number;
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

function isOpenChar(char: string): char is JsonFoldOpenChar {
  return char === '{' || char === '[';
}

function isCloseChar(char: string): char is JsonFoldCloseChar {
  return char === '}' || char === ']';
}

function getCloseChar(openChar: JsonFoldOpenChar): JsonFoldCloseChar {
  return openChar === '{' ? '}' : ']';
}
