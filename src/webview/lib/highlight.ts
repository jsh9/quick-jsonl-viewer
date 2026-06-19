export interface JsonHighlightToken {
  readonly text: string;
  readonly className: string;
}

export function tokenizeJson(value: string): JsonHighlightToken[] {
  const tokens: JsonHighlightToken[] = [];

  let index = 0;
  while (index < value.length) {
    const char = value.charAt(index);

    if (char === '"') {
      const end = findStringEnd(value, index);
      const token = value.slice(index, end);
      tokens.push({
        text: token,
        className: isObjectKey(value, end)
          ? 'json-token key'
          : 'json-token string'
      });
      index = end;
      continue;
    }

    const number = readNumber(value, index);
    if (number) {
      tokens.push({ text: number, className: 'json-token number' });
      index += number.length;
      continue;
    }

    if (readKeyword(value, index, 'true')) {
      tokens.push({ text: 'true', className: 'json-token boolean' });
      index += 4;
      continue;
    }

    if (readKeyword(value, index, 'false')) {
      tokens.push({ text: 'false', className: 'json-token boolean' });
      index += 5;
      continue;
    }

    if (readKeyword(value, index, 'null')) {
      tokens.push({ text: 'null', className: 'json-token null' });
      index += 4;
      continue;
    }

    if ('{}[]:,'.includes(char)) {
      tokens.push({ text: char, className: 'json-token punctuation' });
      index += 1;
      continue;
    }

    tokens.push({ text: char, className: '' });
    index += 1;
  }

  return tokens;
}

export function findStringEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value.charAt(index);

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      return index + 1;
    }
  }

  return value.length;
}

export function isObjectKey(value: string, stringEnd: number): boolean {
  let index = stringEnd;
  while (index < value.length && /\s/.test(value.charAt(index))) {
    index += 1;
  }

  return value.charAt(index) === ':';
}

export function readNumber(value: string, start: number): string {
  const match = value
    .slice(start)
    .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) {
    return '';
  }

  const token = match[0];
  return isTokenBoundary(value.charAt(start + token.length)) ? token : '';
}

export function readKeyword(
  value: string,
  start: number,
  keyword: 'true' | 'false' | 'null'
): boolean {
  if (!value.startsWith(keyword, start)) {
    return false;
  }

  return isTokenBoundary(value.charAt(start + keyword.length));
}

export function isTokenBoundary(char: string): boolean {
  return !char || !/[A-Za-z0-9_$]/.test(char);
}
