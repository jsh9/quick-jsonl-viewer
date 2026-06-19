import { getWebviewScript } from './script';
import { getWebviewStyles } from './styles';

export function getHtml(fileName: string): string {
  const nonce = getNonce();
  const escapedTitle = escapeHtml(fileName);

  /* c8 ignore start -- Embedded webview browser code is covered by source-contract tests until it is split into executable modules. */
  const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style nonce="${nonce}">
${getWebviewStyles()}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="info" aria-live="polite">
      <span class="info-item"><strong>Size:</strong> <span id="file-size">Loading...</span></span>
      <span class="info-item"><strong>Total lines:</strong> <span id="line-count">Counting...</span></span>
      <label class="rows-control info-item"><strong>Show</strong> <input id="rows-input" class="rows-input" type="number" min="0" step="1" inputmode="numeric" aria-describedby="rows-error"> <span>rows</span></label>
      <span id="rows-error" class="rows-error" role="status"></span>
      <span class="info-item"><strong>Modified:</strong> <span id="modified">Loading...</span></span>
      <span id="preview-status"></span>
    </div>
    <div class="actions">
      <div class="mode-tabs" role="toolbar" aria-label="JSONL view mode">
        <button class="mode-button" type="button" data-mode="pretty" aria-pressed="true">Pretty print</button>
        <button class="mode-button" type="button" data-mode="wrappedRaw" aria-pressed="false">Raw (wrapped)</button>
        <button class="mode-button" type="button" data-mode="rawLine" aria-pressed="false">Raw (unwrapped)</button>
        <button class="mode-button raw-action" type="button" id="raw-contents">Raw contents</button>
      </div>
    </div>
  </header>
  <main id="content" tabindex="-1">
    <p class="status">Loading JSONL preview...</p>
  </main>
  <script nonce="${nonce}">
${getWebviewScript()}
  </script>
</body>
</html>`;
  /* c8 ignore stop */
  return html;
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
