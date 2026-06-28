export const COLLAPSED_PREVIEW_MAX_LENGTH = 220;

export function getCollapsedPreview(
  value: string,
  maxLength = COLLAPSED_PREVIEW_MAX_LENGTH
): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return compact.slice(0, Math.max(0, maxLength)).trimEnd() + ' ...';
}

export function getHiddenLineCountText(formatted: string): string {
  const lineCount = countLines(formatted);
  return lineCount === 1
    ? '1 line hidden'
    : String(lineCount) + ' lines hidden';
}

export function countLines(value: string): number {
  if (!value) {
    return 0;
  }

  return value.split('\n').length;
}
