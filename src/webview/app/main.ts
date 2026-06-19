import { collectDomElements } from './dom';
import { createWebviewApp } from './app';
import type { VscodeApi } from './render';

declare function acquireVsCodeApi(): VscodeApi;

const vscode = acquireVsCodeApi();
const elements = collectDomElements();

createWebviewApp(vscode, elements);
vscode.postMessage({ type: 'ready' });
