export function getWebviewStyles(): string {
  return /* css */ `    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    .info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
    }

    .info-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .info-item:not(:first-child)::before {
      content: "|";
      color: var(--vscode-descriptionForeground);
      margin-right: 4px;
      user-select: none;
    }

    #preview-status:empty {
      display: none;
    }

    .info strong {
      color: var(--vscode-editor-foreground);
      font-weight: 600;
    }

    .rows-control {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .preference-control {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .preference-control input {
      margin: 0;
    }

    .rows-input {
      appearance: textfield;
      -moz-appearance: textfield;
      width: 72px;
      min-width: 0;
      border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
      border-radius: 3px;
      padding: 2px 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }

    .rows-input::-webkit-inner-spin-button,
    .rows-input::-webkit-outer-spin-button {
      margin: 0;
      -webkit-appearance: none;
    }

    .rows-input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }

    .rows-input.invalid {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-input-foreground));
    }

    .rows-input:disabled {
      opacity: 0.55;
    }

    .rows-error {
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      flex-wrap: wrap;
    }

    button {
      min-width: 104px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 4px 10px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font: inherit;
      cursor: pointer;
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    #refresh {
      min-width: auto;
    }

    .mode-tabs {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .mode-button {
      min-width: auto;
      border: 0;
      padding: 4px 9px;
      color: var(--vscode-foreground);
      background: transparent;
    }

    .mode-button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .mode-button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .mode-button.raw-action {
      border-left: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 0 2px 2px 0;
    }

    main {
      padding: 12px;
    }

    .status,
    .error-panel {
      margin: 0 0 12px;
      color: var(--vscode-descriptionForeground);
    }

    .error-panel {
      padding: 10px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .entry {
      display: grid;
      grid-template-columns: minmax(44px, max-content) minmax(0, 1fr);
      gap: 10px;
      margin: 0 0 10px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }

    .entry.error {
      border-color: var(--vscode-inputValidation-warningBorder);
    }

    .entry.oversized {
      border-color: var(--vscode-inputValidation-infoBorder, var(--vscode-inputValidation-warningBorder));
    }

    .line-number {
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      gap: 4px;
      padding: 10px 8px;
      color: var(--vscode-editorLineNumber-foreground);
      background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
      text-align: right;
      user-select: none;
    }

    .line-number-text {
      line-height: 1.45;
    }

    .collapse-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 18px;
      width: 18px;
      min-width: 18px;
      height: 18px;
      margin: 1px 0 0;
      border: 0;
      border-radius: 3px;
      padding: 0;
      color: inherit;
      background: transparent;
    }

    .collapse-toggle::before {
      content: "";
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid currentColor;
      transform: rotate(90deg);
    }

    .collapse-toggle[aria-expanded="false"]::before {
      transform: none;
    }

    .collapse-toggle:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .line-body {
      min-width: 0;
      padding: 10px 12px;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.45;
    }

    .entry.raw-line .line-body {
      overflow-x: auto;
    }

    .entry.raw-line pre {
      white-space: pre;
      overflow-wrap: normal;
    }

    .collapsed-summary {
      display: flex;
      align-items: baseline;
      gap: 10px;
      min-width: 0;
    }

    .collapsed-preview {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow-wrap: normal;
    }

    .collapsed-meta {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .pretty-json {
      min-width: 0;
    }

    .pretty-json-line {
      display: flex;
      align-items: flex-start;
      min-width: 0;
    }

    .pretty-json-prefix {
      flex: 0 0 auto;
      min-height: 1.45em;
      background-repeat: repeat-x;
      background-size: var(--json-indent-step, 2ch) 100%;
    }

    .indent-guides-enabled .pretty-json-prefix {
      background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(var(--json-indent-step, 2ch) - 1px),
        var(--vscode-editorIndentGuide-background, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.28))) calc(var(--json-indent-step, 2ch) - 1px),
        var(--vscode-editorIndentGuide-background, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.28))) var(--json-indent-step, 2ch)
      );
    }

    .pretty-json-code {
      flex: 1 1 auto;
      min-width: 0;
    }

    .json-fold-toggle,
    .json-fold-spacer {
      flex: 0 0 18px;
      width: 18px;
      min-width: 18px;
      height: 1.45em;
      margin: 0 2px 0 0;
    }

    .json-fold-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 3px;
      padding: 0;
      color: var(--vscode-editorLineNumber-foreground);
      background: transparent;
    }

    .json-fold-toggle::before {
      content: "";
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid currentColor;
      transform: rotate(90deg);
    }

    .json-fold-toggle[aria-expanded="false"]::before {
      transform: none;
    }

    .json-fold-toggle:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }

    .json-token.key {
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
    }

    .json-token.string {
      color: var(--vscode-debugTokenExpression-string, #ce9178);
    }

    .json-token.number {
      color: var(--vscode-debugTokenExpression-number, #b5cea8);
    }

    .json-token.boolean,
    .json-token.null {
      color: var(--vscode-debugTokenExpression-boolean, #569cd6);
    }

    .json-token.punctuation {
      color: var(--vscode-descriptionForeground);
    }

    .parse-error {
      margin: 0 0 8px;
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground));
      font-weight: 600;
    }

    .oversized-warning {
      margin: 0 0 8px;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }

    .oversized-preview {
      max-height: 12em;
      overflow: hidden;
      color: var(--vscode-descriptionForeground);
    }

    .progress-panel {
      display: grid;
      gap: 10px;
      max-width: 720px;
      padding: 12px;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .progress-track {
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-progressBar-background, var(--vscode-editorWidget-border));
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--vscode-button-background);
      transition: width 120ms linear;
    }

    .progress-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      color: var(--vscode-descriptionForeground);
    }

    .virtual-scroll {
      height: calc(100vh - 78px);
      min-height: 240px;
      overflow: auto;
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-editor-background);
    }

    .virtual-spacer {
      position: relative;
      min-height: 100%;
    }

    .virtual-rows {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      will-change: transform;
    }

    .virtual-row {
      margin: 4px 6px;
    }

    .virtual-row.raw-line .line-body {
      overflow-x: auto;
    }

    @media (max-width: 640px) {
      .topbar {
        align-items: stretch;
        flex-direction: column;
      }

      .actions,
      .mode-tabs {
        width: 100%;
      }

      .mode-button {
        flex: 1 1 auto;
      }

      .collapsed-summary {
        align-items: stretch;
        flex-direction: column;
        gap: 4px;
      }

      .collapsed-meta {
        white-space: normal;
      }
    }`;
}
