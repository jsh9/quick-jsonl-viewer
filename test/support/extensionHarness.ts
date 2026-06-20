import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before } from 'node:test';

export interface Disposable {
  dispose(): void;
}

export interface RecordedCommand {
  readonly command: string;
  readonly args: unknown[];
}

export interface RegisteredProvider {
  readonly viewType: string;
  readonly provider: {
    openCustomDocument(uri: FakeUri): Promise<{ readonly uri: FakeUri }>;
    resolveCustomEditor(
      document: { readonly uri: FakeUri },
      webviewPanel: FakeWebviewPanel,
      token: unknown
    ): Promise<void>;
  };
  readonly options: unknown;
}

export class FakeUri {
  public constructor(
    public readonly fsPath: string,
    public readonly scheme = 'file'
  ) {}

  public toString(): string {
    return `${this.scheme}:${this.fsPath}`;
  }

  public static file(fsPath: string): FakeUri {
    return new FakeUri(fsPath);
  }

  public static joinPath(base: FakeUri, ...segments: string[]): FakeUri {
    return new FakeUri(path.join(base.fsPath, ...segments), base.scheme);
  }
}

export class FakeTabInputText {
  public constructor(public readonly uri: FakeUri) {}
}

export class FakeTabInputCustom {
  public constructor(public readonly uri: FakeUri) {}
}

export class FakeTabInputTextDiff {
  public constructor(
    public readonly original: FakeUri,
    public readonly modified: FakeUri
  ) {}
}

export class FakeWebview {
  public options: unknown;
  public html = '';
  public readonly messages: unknown[] = [];
  private readonly messageListeners: Array<(message: unknown) => void> = [];

  public onDidReceiveMessage(listener: (message: unknown) => void): Disposable {
    this.messageListeners.push(listener);
    return {
      dispose: () => {
        const index = this.messageListeners.indexOf(listener);
        if (index >= 0) {
          this.messageListeners.splice(index, 1);
        }
      }
    };
  }

  public async postMessage(message: unknown): Promise<boolean> {
    this.messages.push(message);
    return true;
  }

  public receive(message: unknown): void {
    for (const listener of [...this.messageListeners]) {
      listener(message);
    }
  }
}

export class FakeWebviewPanel {
  public readonly webview = new FakeWebview();
  public viewColumn: number | undefined = FakeVscode.ViewColumn.One;
  public readonly revealCalls: Array<readonly [number, boolean]> = [];
  private readonly disposeListeners: Array<() => void> = [];

  public reveal(viewColumn: number, preserveFocus: boolean): void {
    this.revealCalls.push([viewColumn, preserveFocus]);
  }

  public onDidDispose(listener: () => void): Disposable {
    this.disposeListeners.push(listener);
    return {
      dispose: () => {
        const index = this.disposeListeners.indexOf(listener);
        if (index >= 0) {
          this.disposeListeners.splice(index, 1);
        }
      }
    };
  }

  public dispose(): void {
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }
}

export class FakeVscode {
  public static readonly ViewColumn = {
    Active: -1,
    Beside: -2,
    One: 1
  } as const;

  public static readonly ConfigurationTarget = {
    Global: 1
  } as const;

  public readonly warnings: string[] = [];
  public readonly errors: string[] = [];
  public readonly registeredCommands = new Map<
    string,
    (...args: unknown[]) => unknown
  >();
  public readonly executedCommands: RecordedCommand[] = [];
  public readonly providerRegistrations: RegisteredProvider[] = [];
  public readonly configurationUpdates: Array<{
    readonly key: string;
    readonly value: unknown;
    readonly target: unknown;
  }> = [];
  public readonly configurationListeners: Array<{
    readonly listener: (event: {
      affectsConfiguration(section: string): boolean;
    }) => void;
    disposed: boolean;
  }> = [];
  public readonly saveListeners: Array<{
    readonly listener: (document: { readonly uri: FakeUri }) => void;
    disposed: boolean;
  }> = [];
  public activeTextEditorUri: FakeUri | undefined;
  public activeTabInput: unknown;
  public maxLines = 20;
  public indent = 2;
  public executeCommandError: unknown;
  public configurationUpdateError: unknown;

  public readonly vscode = {
    commands: {
      registerCommand: (
        command: string,
        callback: (...args: unknown[]) => unknown
      ): Disposable => {
        this.registeredCommands.set(command, callback);
        return disposable();
      },
      executeCommand: async (
        command: string,
        ...args: unknown[]
      ): Promise<unknown> => {
        this.executedCommands.push({ command, args });
        if (this.executeCommandError) {
          throw this.executeCommandError;
        }

        return undefined;
      }
    },
    workspace: {
      getConfiguration: (section: string) => {
        assert.equal(section, 'quickJsonlViewer');
        return {
          get: (key: string): unknown => {
            if (key === 'maxLines') {
              return this.maxLines;
            }

            if (key === 'indent') {
              return this.indent;
            }

            return undefined;
          },
          update: async (
            key: string,
            value: unknown,
            target: unknown
          ): Promise<void> => {
            if (this.configurationUpdateError) {
              throw this.configurationUpdateError;
            }

            this.configurationUpdates.push({ key, value, target });
            if (key === 'maxLines' && typeof value === 'number') {
              this.maxLines = value;
            }
          }
        };
      },
      onDidChangeConfiguration: (
        listener: (event: {
          affectsConfiguration(section: string): boolean;
        }) => void
      ): Disposable => {
        const registration = { listener, disposed: false };
        this.configurationListeners.push(registration);
        return {
          dispose: () => {
            registration.disposed = true;
          }
        };
      },
      onDidSaveTextDocument: (
        listener: (document: { readonly uri: FakeUri }) => void
      ): Disposable => {
        const registration = { listener, disposed: false };
        this.saveListeners.push(registration);
        return {
          dispose: () => {
            registration.disposed = true;
          }
        };
      }
    },
    window: {
      get activeTextEditor() {
        return thisOwner.activeTextEditorUri
          ? { document: { uri: thisOwner.activeTextEditorUri } }
          : undefined;
      },
      tabGroups: {
        activeTabGroup: {
          get activeTab() {
            return thisOwner.activeTabInput
              ? { input: thisOwner.activeTabInput }
              : undefined;
          }
        }
      },
      showWarningMessage: async (message: string): Promise<void> => {
        this.warnings.push(message);
      },
      showErrorMessage: async (message: string): Promise<void> => {
        this.errors.push(message);
      },
      registerCustomEditorProvider: (
        viewType: string,
        provider: RegisteredProvider['provider'],
        options: unknown
      ): Disposable => {
        this.providerRegistrations.push({ viewType, provider, options });
        return disposable();
      }
    },
    Uri: FakeUri,
    ViewColumn: FakeVscode.ViewColumn,
    ConfigurationTarget: FakeVscode.ConfigurationTarget,
    TabInputText: FakeTabInputText,
    TabInputCustom: FakeTabInputCustom,
    TabInputTextDiff: FakeTabInputTextDiff
  };

  public fireConfigurationChange(sections: readonly string[]): void {
    const event = {
      affectsConfiguration: (section: string): boolean =>
        sections.includes(section)
    };
    for (const registration of this.configurationListeners) {
      if (!registration.disposed) {
        registration.listener(event);
      }
    }
  }

  public fireSave(uri: FakeUri): void {
    for (const registration of this.saveListeners) {
      if (!registration.disposed) {
        registration.listener({ uri });
      }
    }
  }
}

export const thisOwner = {
  activeTextEditorUri: undefined as FakeUri | undefined,
  activeTabInput: undefined as unknown
};

export let tempDir = '';

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quick-jsonl-viewer-ext-'));
});

after(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

export function activateAndGetProvider(
  harness: ReturnType<typeof loadExtension>
): RegisteredProvider['provider'] {
  harness.extension.activate(createContext());
  const provider = harness.fake.providerRegistrations[0]?.provider;
  assert.ok(provider);
  return provider;
}

export function createContext(extensionUri = FakeUri.file(tempDir)): {
  readonly extensionUri: FakeUri;
  readonly subscriptions: Disposable[];
} {
  return {
    extensionUri,
    subscriptions: []
  };
}

export function getCommand(
  fake: FakeVscode,
  command: string
): (...args: unknown[]) => Promise<unknown> {
  const callback = fake.registeredCommands.get(command);
  assert.ok(callback);
  return async (...args: unknown[]) => callback(...args);
}

const EXTENSION_MODULE_PATHS = [
  '../../src/extension',
  '../../src/constants',
  '../../src/commands',
  '../../src/viewerProvider',
  '../../src/viewerData',
  '../../src/viewerProtocol',
  '../../src/webview/html',
  '../../src/webview/script',
  '../../src/webview/styles'
];

export function clearExtensionModuleCache(): void {
  for (const modulePath of EXTENSION_MODULE_PATHS) {
    delete require.cache[require.resolve(modulePath)];
  }
}

export function loadExtension(
  jsonlOverrides: Record<string, unknown> = {},
  nodeFsOverrides: Record<string, unknown> = {},
  nodeFsPromisesOverrides: Record<string, unknown> = {}
): {
  readonly fake: FakeVscode;
  readonly extension: {
    activate(context: unknown): void;
    deactivate(): void;
  };
  readonly restore: () => void;
} {
  const fake = new FakeVscode();
  const realJsonl = require('../../src/jsonl') as Record<string, unknown>;
  const realNodeFs = require('node:fs') as Record<string, unknown>;
  const realNodeFsPromises = require('node:fs/promises') as Record<
    string,
    unknown
  >;
  const loader = require('node:module') as {
    _load(request: string, parent: unknown, isMain: boolean): unknown;
  };
  const originalLoad = loader._load;
  loader._load = function load(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean
  ): unknown {
    if (request === 'vscode') {
      return fake.vscode;
    }

    if (request === 'node:fs' && Object.keys(nodeFsOverrides).length > 0) {
      return {
        ...realNodeFs,
        ...nodeFsOverrides
      };
    }

    if (
      request === 'node:fs/promises' &&
      Object.keys(nodeFsPromisesOverrides).length > 0
    ) {
      return {
        ...realNodeFsPromises,
        ...nodeFsPromisesOverrides
      };
    }

    if (request === './jsonl') {
      return {
        ...realJsonl,
        ...jsonlOverrides
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  clearExtensionModuleCache();
  const extension = require('../../src/extension') as {
    activate(context: unknown): void;
    deactivate(): void;
  };

  return {
    fake,
    extension,
    restore: () => {
      loader._load = originalLoad;
      clearExtensionModuleCache();
    }
  };
}

function disposable(): Disposable {
  return {
    dispose: () => undefined
  };
}

export async function writeFixture(
  fileName: string,
  contents: string
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, contents, 'utf8');
  return filePath;
}

export async function waitForMessage<T extends { readonly type?: unknown }>(
  panel: FakeWebviewPanel,
  predicate: (
    message: { readonly type?: unknown } & Record<string, unknown>
  ) => boolean,
  timeoutMs = 500
): Promise<T> {
  await waitFor(
    () =>
      panel.webview.messages.some((message) =>
        predicate(
          message as { readonly type?: unknown } & Record<string, unknown>
        )
      ),
    timeoutMs
  );
  const message = panel.webview.messages.find((item) =>
    predicate(item as { readonly type?: unknown } & Record<string, unknown>)
  );
  assert.ok(message);
  return message as T;
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 500
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for test condition.');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function getMessageType(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'type' in message
    ? message.type
    : undefined;
}

export async function sleep(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
