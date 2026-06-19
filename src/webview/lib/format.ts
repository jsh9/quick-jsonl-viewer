export function formatPercent(value: number): string {
  return Math.max(0, Math.min(100, value)).toFixed(1) + '%';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0
    ? String(bytes) + ' B'
    : value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  return Math.trunc(value).toLocaleString('en-US');
}
