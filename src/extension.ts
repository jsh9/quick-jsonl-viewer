import * as vscode from 'vscode';
import {
  COMMAND_OPEN_CURRENT_FILE,
  COMMAND_OPEN_SAMPLE_FILES,
  VIEW_TYPE
} from './constants';
import { openJsonlViewer, openSampleJsonlFiles } from './commands';
import { JsonlViewerProvider } from './viewerProvider';
import { formatError } from './viewerProtocol';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      COMMAND_OPEN_CURRENT_FILE,
      (resource?: vscode.Uri) => {
        void openJsonlViewer(resource).catch((error: unknown) => {
          void vscode.window.showErrorMessage(
            `Quick JSONL Viewer failed to open the file: ${formatError(error)}`
          );
        });
      }
    ),
    vscode.commands.registerCommand(COMMAND_OPEN_SAMPLE_FILES, () => {
      void openSampleJsonlFiles(context.extensionUri).catch(
        (error: unknown) => {
          void vscode.window.showErrorMessage(
            `Quick JSONL Viewer failed to open sample files: ${formatError(error)}`
          );
        }
      );
    }),
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new JsonlViewerProvider(),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          enableFindWidget: true,
          retainContextWhenHidden: true
        }
      }
    )
  );
}

export function deactivate(): void {
  // Nothing to dispose; VS Code owns provider subscriptions registered on activation.
}
