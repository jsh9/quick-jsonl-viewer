import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedWebviewScript: string | undefined;

export function getWebviewScript(): string {
  if (!cachedWebviewScript) {
    cachedWebviewScript = fs.readFileSync(getWebviewBundlePath(), 'utf8');
  }

  return cachedWebviewScript;
}

function getWebviewBundlePath(): string {
  return path.resolve(__dirname, '../../webview/main.js');
}
