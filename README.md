# Quick JSONL Viewer

Quick JSONL Viewer opens `.jsonl` files in a readonly, formatted VS Code custom editor designed to stay responsive with large JSON Lines files.

## 1. Features

- Open `.jsonl` files in a readonly custom editor with Pretty print, Raw (wrapped), and Raw (unwrapped) modes.
- See useful file context, including file size, total lines, and last modified time.
- Keep large files responsive with configurable preview limits and indexed virtual rendering.

Screenshot placeholders:

- `images/screenshots/pretty-print.png`: Pretty print view showing formatted JSONL rows and file metadata.
- `images/screenshots/raw-views.png`: Raw (wrapped) and Raw (unwrapped) views showing unformatted JSONL content in the custom viewer.
- `images/screenshots/indexed-large-file.png`: Large-file indexed mode showing responsive scrolling through a full JSONL file.

## 2. Usage

Open any `.jsonl` file in VS Code and Quick JSONL Viewer opens it with the custom viewer by default.

You can also run `Quick JSONL Viewer: Open in Quick JSONL Viewer` from the command palette, the editor title menu, or the Explorer context menu for a `.jsonl` file.

## 3. Settings

- `quickJsonlViewer.maxLines`: number of lines to show. Default is `20`.
- `quickJsonlViewer.maxLines: 0`: index the full file and render visible rows on demand.
- The info bar `Show [input] rows` control updates `quickJsonlViewer.maxLines` globally when you press Enter or leave the field.
- `quickJsonlViewer.indent`: number of spaces for Pretty print formatting. Default is `2`; minimum is `1`.

## 4. Indexed Mode

When `quickJsonlViewer.maxLines` is `0` or a large positive preview count, Quick JSONL Viewer does not send the whole file to the webview for Pretty print, Raw (wrapped), or Raw (unwrapped). It builds a byte-offset line index with progress, then the webview requests only the visible row range while scrolling. This keeps DOM size bounded for very large files.

## 5. Raw Contents

`Raw contents` opens the file in VS Code's default text editor. The extension's top info bar is not available there, but you can return to the viewer with `Open in Quick JSONL Viewer` from the editor title, Explorer context menu, or command palette.

## 6. For Developers

```sh
npm install
npm test
```

`npm install` installs Husky hooks automatically. The pre-commit hook runs `npm test`.

Use VS Code's extension host launch flow to test the viewer manually with the small and large files in `sample-data/`.

The `Run Extension` launch configuration opens `sample-data/sample-data.jsonl` and `sample-data/large-placeholder.jsonl` through the internal `quickJsonlViewer.openSampleFiles` command. These `.jsonl` files are local-only test fixtures and are ignored by Git. Generate the large file with:

```sh
python3 sample-data/generate_large_jsonl.py
```

Create or copy a small `sample-data/sample-data.jsonl` locally when using the launch flow.
