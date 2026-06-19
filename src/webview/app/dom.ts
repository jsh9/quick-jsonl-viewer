export interface WebviewElements {
  readonly content: HTMLElement;
  readonly modeButtons: HTMLButtonElement[];
  readonly rawContentsButton: HTMLButtonElement;
  readonly fileSize: HTMLElement;
  readonly lineCount: HTMLElement;
  readonly rowsInput: HTMLInputElement;
  readonly rowsError: HTMLElement;
  readonly modified: HTMLElement;
  readonly previewStatus: HTMLElement;
}

export function collectDomElements(): WebviewElements {
  return {
    content: getRequiredElement('content'),
    modeButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-mode]')
    ),
    rawContentsButton: getRequiredElement('raw-contents'),
    fileSize: getRequiredElement('file-size'),
    lineCount: getRequiredElement('line-count'),
    rowsInput: getRequiredElement('rows-input'),
    rowsError: getRequiredElement('rows-error'),
    modified: getRequiredElement('modified'),
    previewStatus: getRequiredElement('preview-status')
  };
}

export function setControlsDisabled(
  elements: WebviewElements,
  disabled: boolean
): void {
  for (const button of elements.modeButtons) {
    button.disabled = disabled;
  }
  elements.rawContentsButton.disabled = disabled;
  elements.rowsInput.disabled = disabled;
}

export function status(message: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = 'status';
  element.textContent = message;
  return element;
}

export function textSpan(message: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.textContent = message;
  return element;
}

function getRequiredElement<TElement extends HTMLElement>(
  id: string
): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing webview element: ${id}`);
  }

  return element as TElement;
}
