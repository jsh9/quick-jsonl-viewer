import * as vscode from 'vscode';
import { normalizeViewerSettings, ViewerSettings } from './jsonl';
import { SETTINGS_SECTION } from './constants';

export type WebviewRenderMode = 'pretty' | 'wrappedRaw' | 'rawLine';

export function getWebviewRenderMode(value: unknown): WebviewRenderMode {
  if (value === 'wrappedRaw' || value === 'rawLine') {
    return value;
  }

  return 'pretty';
}

export function getSettings(): ViewerSettings {
  const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return normalizeViewerSettings({
    maxLines: configuration.get('maxLines'),
    indent: configuration.get('indent'),
    autoRefresh: configuration.get('autoRefresh'),
    indentGuides: configuration.get('indentGuides'),
    maxRenderedRowBytes: configuration.get('maxRenderedRowBytes'),
    oversizedRowPreviewBytes: configuration.get('oversizedRowPreviewBytes')
  });
}

export function clampMessageInteger(
  value: unknown,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

export interface WebviewMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly start?: unknown;
  readonly count?: unknown;
  readonly mode?: unknown;
  readonly value?: unknown;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
