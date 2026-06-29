import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { test } from 'node:test';
import * as vm from 'node:vm';

type FakeEventListener = (event: FakeEvent) => void;
type FakeMessageListener = (event: { readonly data: unknown }) => void;
type FakeNodeLike = FakeElement | FakeTextNode | FakeFragment;

class FakeEvent {
  public defaultPrevented = false;
  public propagationStopped = false;

  public constructor(public readonly type: string) {}

  public preventDefault(): void {
    this.defaultPrevented = true;
  }

  public stopPropagation(): void {
    this.propagationStopped = true;
  }
}

class FakeStyle {
  public height = '';
  public transform = '';
  public width = '';
  private readonly properties = new Map<string, string>();

  public setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }

  public getPropertyValue(name: string): string {
    return this.properties.get(name) ?? '';
  }
}

class FakeTextNode {
  public parentNode: FakeElement | FakeFragment | null = null;

  public constructor(private text = '') {}

  public get textContent(): string {
    return this.text;
  }

  public set textContent(value: string) {
    this.text = value;
  }
}

class FakeFragment {
  public readonly childNodes: FakeNodeLike[] = [];
  public parentNode: FakeElement | FakeFragment | null = null;

  public get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  public set textContent(value: string) {
    this.childNodes.length = 0;
    this.childNodes.push(new FakeTextNode(value));
  }

  public append(...nodes: Array<FakeNodeLike | string>): void {
    appendNodes(this, nodes);
  }
}

class FakeElement {
  public checked = false;
  public clientHeight = 600;
  public dataset: Record<string, string> = {};
  public disabled = false;
  public hidden = false;
  public id = '';
  public parentNode: FakeElement | FakeFragment | null = null;
  public readonly childNodes: FakeNodeLike[] = [];
  public readonly listeners = new Map<string, FakeEventListener[]>();
  public readonly style = new FakeStyle();
  public title = '';
  public type = '';
  public value = '';
  private readonly attributes = new Map<string, string>();
  private readonly classes = new Set<string>();
  private text = '';

  public readonly classList = {
    add: (...names: string[]): void => {
      for (const name of names) {
        this.classes.add(name);
      }
    },
    remove: (...names: string[]): void => {
      for (const name of names) {
        this.classes.delete(name);
      }
    },
    contains: (name: string): boolean => this.classes.has(name),
    toggle: (name: string, force?: boolean): boolean => {
      const shouldAdd = force ?? !this.classes.has(name);
      if (shouldAdd) {
        this.classes.add(name);
      } else {
        this.classes.delete(name);
      }
      return shouldAdd;
    }
  };

  public constructor(public readonly tagName: string) {}

  public get children(): FakeElement[] {
    return this.childNodes.filter(
      (node): node is FakeElement => node instanceof FakeElement
    );
  }

  public get className(): string {
    return Array.from(this.classes).join(' ');
  }

  public set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/)) {
      if (name) {
        this.classes.add(name);
      }
    }
  }

  public get textContent(): string {
    return this.text + this.childNodes.map((node) => node.textContent).join('');
  }

  public set textContent(value: string) {
    this.text = value;
    this.childNodes.length = 0;
  }

  public addEventListener(type: string, listener: FakeEventListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public append(...nodes: Array<FakeNodeLike | string>): void {
    appendNodes(this, nodes);
  }

  public click(): void {
    this.dispatchEvent(new FakeEvent('click'));
  }

  public dispatchEvent(event: FakeEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
  }

  public focus(): void {
    // No focus state is needed for these interaction tests.
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public getBoundingClientRect(): { readonly height: number } {
    return { height: 40 };
  }

  public querySelector(selector: string): FakeElement | null {
    return querySelector(this, selector);
  }

  public querySelectorAll(selector: string): FakeElement[] {
    return querySelectorAll(this, selector);
  }

  public replaceChildren(...nodes: Array<FakeNodeLike | string>): void {
    for (const node of this.childNodes) {
      node.parentNode = null;
    }
    this.childNodes.length = 0;
    this.text = '';
    appendNodes(this, nodes);
  }

  public replaceWith(replacement: FakeNodeLike): void {
    const parent = this.parentNode;
    if (!parent) {
      return;
    }

    const index = parent.childNodes.indexOf(this);
    if (index < 0) {
      return;
    }

    this.parentNode = null;
    replacement.parentNode = parent;
    parent.childNodes.splice(index, 1, replacement);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  public readonly body = new FakeElement('body');
  private readonly elementsById = new Map<string, FakeElement>();

  public createDocumentFragment(): FakeFragment {
    return new FakeFragment();
  }

  public createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  public createTextNode(text: string): FakeTextNode {
    return new FakeTextNode(text);
  }

  public getElementById(id: string): FakeElement | null {
    return this.elementsById.get(id) ?? null;
  }

  public querySelector(selector: string): FakeElement | null {
    return querySelector(this.body, selector);
  }

  public querySelectorAll(selector: string): FakeElement[] {
    return querySelectorAll(this.body, selector);
  }

  public registerElement(id: string, tagName = 'div'): FakeElement {
    const element = this.createElement(tagName);
    element.id = id;
    this.elementsById.set(id, element);
    this.body.append(element);
    return element;
  }
}

class FakeWindow {
  private readonly messageListeners: FakeMessageListener[] = [];

  public addEventListener(type: string, listener: FakeMessageListener): void {
    if (type === 'message') {
      this.messageListeners.push(listener);
    }
  }

  public postMessage(data: unknown): void {
    this.dispatchMessage(data);
  }

  public dispatchMessage(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }
}

interface WebviewFixture {
  readonly document: FakeDocument;
  readonly messages: unknown[];
  readonly window: FakeWindow;
}

interface JsonEntry {
  readonly kind: 'json';
  readonly lineNumber: number;
  readonly raw: string;
  readonly formatted: string;
}

interface OversizedEntry {
  readonly kind: 'oversized';
  readonly lineNumber: number;
  readonly byteLength: number;
  readonly limitBytes: number;
  readonly preview: string;
}

type JsonlEntry = JsonEntry | OversizedEntry;

function appendNodes(
  parent: FakeElement | FakeFragment,
  nodes: Array<FakeNodeLike | string>
): void {
  for (const node of nodes.flatMap(expandNode)) {
    node.parentNode = parent;
    parent.childNodes.push(node);
  }
}

function expandNode(node: FakeNodeLike | string): FakeNodeLike[] {
  if (typeof node === 'string') {
    return [new FakeTextNode(node)];
  }

  if (node instanceof FakeFragment) {
    const children = [...node.childNodes];
    node.childNodes.length = 0;
    return children;
  }

  return [node];
}

function querySelector(
  root: FakeElement,
  selector: string
): FakeElement | null {
  return querySelectorAll(root, selector)[0] ?? null;
}

function querySelectorAll(root: FakeElement, selector: string): FakeElement[] {
  const matches: FakeElement[] = [];

  for (const node of root.childNodes) {
    if (!(node instanceof FakeElement)) {
      continue;
    }

    if (matchesSelector(node, selector)) {
      matches.push(node);
    }
    matches.push(...querySelectorAll(node, selector));
  }

  return matches;
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  if (selector.startsWith('#')) {
    return element.id === selector.slice(1);
  }

  const attributeOnly = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attributeOnly) {
    const [, name, value] = attributeOnly;
    const actual = getSelectorAttribute(element, name);
    return value === undefined ? actual !== null : actual === value;
  }

  const classWithAttribute =
    /^((?:\.[\w-]+)+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(selector);
  if (!classWithAttribute) {
    return false;
  }

  const [, classSelector, attributeName, attributeValue] = classWithAttribute;
  const classNames = classSelector
    .split('.')
    .filter((className) => className.length > 0);
  if (!classNames.every((className) => element.classList.contains(className))) {
    return false;
  }

  return attributeName
    ? getSelectorAttribute(element, attributeName) === attributeValue
    : true;
}

function getSelectorAttribute(
  element: FakeElement,
  name: string
): string | null {
  if (name.startsWith('data-')) {
    return element.dataset[toCamelCase(name.slice(5))] ?? null;
  }

  return element.getAttribute(name);
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase()
  );
}

async function createWebviewFixture(): Promise<WebviewFixture> {
  const document = new FakeDocument();
  const window = new FakeWindow();
  const messages: unknown[] = [];
  const vscode = {
    postMessage: (message: unknown): void => {
      messages.push(message);
    }
  };

  registerWebviewShell(document);

  const bundle = await fs.readFile(
    path.join(process.cwd(), 'out', 'webview', 'main.js'),
    'utf8'
  );
  const context = vm.createContext({
    acquireVsCodeApi: () => vscode,
    cancelAnimationFrame: () => undefined,
    console,
    document,
    getComputedStyle: () => ({ marginBottom: '0', marginTop: '0' }),
    requestAnimationFrame: (callback: () => void): number => {
      callback();
      return 1;
    },
    window
  });

  vm.runInContext(bundle, context, {
    filename: 'out/webview/main.js'
  });

  return { document, messages, window };
}

function registerWebviewShell(document: FakeDocument): void {
  document.registerElement('content', 'main');
  document.registerElement('refresh', 'button');
  document.registerElement('raw-contents', 'button');
  document.registerElement('file-size');
  document.registerElement('line-count');
  document.registerElement('auto-refresh', 'input').checked = true;
  document.registerElement('indent-guides', 'input').checked = true;
  document.registerElement('start-input', 'input');
  document.registerElement('rows-input', 'input');
  document.registerElement('rows-error');
  document.registerElement('modified');
  document.registerElement('preview-status');

  for (const mode of ['pretty', 'wrappedRaw', 'rawLine']) {
    const button = document.createElement('button');
    button.dataset.mode = mode;
    document.body.append(button);
  }
}

function createJsonEntry(): JsonEntry {
  const value = {
    outer: {
      child: [1, 2]
    },
    message: 'prefix ' + 'x'.repeat(700)
  };
  const raw = JSON.stringify(value);

  return {
    kind: 'json',
    lineNumber: 1,
    raw,
    formatted: JSON.stringify(value, null, 2)
  };
}

function postData(window: FakeWindow, entry: JsonlEntry): void {
  window.dispatchMessage({
    type: 'data',
    payload: {
      fileName: 'collapse.jsonl',
      fileSize: '1 KB',
      indent: 2,
      lastModified: 'today',
      lineCount: 1,
      maxLines: 20,
      preview: {
        displayLimit: 20,
        entries: [entry],
        loadedLineCount: 1,
        plainText: entry.kind === 'json' ? entry.raw : entry.preview
      },
      startLine: 1
    }
  });
}

function queryRequired(document: FakeDocument, selector: string): FakeElement {
  const element = document.querySelector(selector);
  assert.ok(element, `Expected selector to match: ${selector}`);
  return element;
}

function findJsonFoldToggle(
  document: FakeDocument,
  labelPart: string
): FakeElement {
  const toggle = document
    .querySelectorAll('.json-fold-toggle')
    .find((element) => element.getAttribute('aria-label')?.includes(labelPart));

  assert.ok(toggle, `Expected JSON fold toggle containing: ${labelPart}`);
  return toggle;
}

function prettyJsonText(document: FakeDocument): string {
  return document
    .querySelectorAll('.pretty-json-code')
    .map((element) => element.textContent)
    .join('\n');
}

function getMessageType(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'type' in message
    ? message.type
    : undefined;
}

// Verifies an actual compiled-webview click toggles row collapse and rerenders
// the DOM; source-contract tests alone cannot catch a broken event/replace
// path between the button listener and `replaceRenderedEntry()`.
test('webview row collapse click updates the rendered entry DOM', async () => {
  const fixture = await createWebviewFixture();
  const entry = createJsonEntry();

  postData(fixture.window, entry);

  assert.equal(getMessageType(fixture.messages[0]), 'ready');
  assert.equal(
    queryRequired(
      fixture.document,
      '.entry[data-line-number="1"]'
    ).classList.contains('collapsed'),
    false
  );
  assert.equal(
    queryRequired(fixture.document, '.collapse-toggle').getAttribute(
      'aria-expanded'
    ),
    'true'
  );

  queryRequired(fixture.document, '.collapse-toggle').click();

  assert.equal(
    queryRequired(
      fixture.document,
      '.entry[data-line-number="1"]'
    ).classList.contains('collapsed'),
    true
  );
  assert.equal(
    queryRequired(fixture.document, '.collapse-toggle').getAttribute(
      'aria-expanded'
    ),
    'false'
  );
  assert.match(
    queryRequired(fixture.document, '.collapsed-preview').textContent,
    /"outer"/
  );
  assert.match(
    queryRequired(fixture.document, '.collapsed-meta').textContent,
    /lines hidden/
  );
  assert.equal(fixture.document.querySelector('.pretty-json'), null);

  queryRequired(fixture.document, '.collapse-toggle').click();

  assert.equal(
    queryRequired(
      fixture.document,
      '.entry[data-line-number="1"]'
    ).classList.contains('collapsed'),
    false
  );
  assert.ok(fixture.document.querySelector('.pretty-json'));
});

// Verifies nested block and long-value collapse through real compiled-webview
// click handlers, because helper tests do not prove that the rendered buttons
// update keyed collapse state and replace the row in the DOM.
test('webview nested JSON collapse clicks update the rendered row DOM', async () => {
  const fixture = await createWebviewFixture();
  const entry = createJsonEntry();

  postData(fixture.window, entry);

  findJsonFoldToggle(fixture.document, 'pretty-print line 2').click();

  assert.equal(
    findJsonFoldToggle(fixture.document, 'pretty-print line 2').getAttribute(
      'aria-expanded'
    ),
    'false'
  );
  assert.match(prettyJsonText(fixture.document), /"outer": \{ \.\.\. \},/);
  assert.doesNotMatch(prettyJsonText(fixture.document), /"child"/);

  findJsonFoldToggle(fixture.document, 'long JSON value').click();

  assert.equal(
    findJsonFoldToggle(fixture.document, 'long JSON value').getAttribute(
      'aria-expanded'
    ),
    'false'
  );
  assert.match(prettyJsonText(fixture.document), /chars hidden/);
});

test('webview renders oversized rows without expensive JSON rendering', async () => {
  const fixture = await createWebviewFixture();

  postData(fixture.window, {
    kind: 'oversized',
    lineNumber: 9,
    byteLength: 2048,
    limitBytes: 1024,
    preview: '{"message":"preview only ...'
  });

  const entry = queryRequired(fixture.document, '.entry[data-line-number="9"]');
  assert.equal(entry.classList.contains('oversized'), true);
  assert.equal(fixture.document.querySelector('.collapse-toggle'), null);
  assert.equal(fixture.document.querySelector('.pretty-json'), null);
  assert.equal(fixture.document.querySelector('.json-token'), null);
  assert.match(
    queryRequired(fixture.document, '.oversized-warning').textContent,
    /Line skipped:/
  );
  assert.match(
    queryRequired(fixture.document, '.oversized-preview').textContent,
    /preview only/
  );
});
