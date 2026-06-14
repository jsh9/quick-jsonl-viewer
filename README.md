# Quick JSONL Viewer

View and preview large JSONL files very quickly in VS Code.

## Features

- Opens `.jsonl` files in a readonly custom editor.
- Shows top JSONL rows as Pretty print, Wrapped raw, or Raw line in a readonly viewer.
- Opens Raw contents in VS Code's default text editor when you want the normal editor experience.
- Returns from Raw contents through `Open in Quick JSONL Viewer` in the editor title, context menu, or command palette.
- Shows file size, total lines, and last modified time.
- Keeps large files responsive by defaulting to the first 20 rows.
- Supports indexed virtual rendering for full-file mode and large row previews.

## Settings

- `quickJsonlViewer.maxLines`: number of lines to show. Default is `20`.
- `quickJsonlViewer.maxLines: 0`: index the full file and render visible rows on demand.
- The info bar `Show [input] rows` control updates `quickJsonlViewer.maxLines` globally when you press Enter or leave the field.
- `quickJsonlViewer.indent`: number of spaces for Pretty print formatting. Default is `2`; minimum is `1`.

## Indexed mode

When `quickJsonlViewer.maxLines` is `0` or a large positive preview count, Quick JSONL Viewer does not send the whole file to the webview for Pretty print, Wrapped raw, or Raw line. It builds a byte-offset line index with progress, then the webview requests only the visible row range while scrolling. This keeps DOM size bounded for very large files.

## Raw contents

`Raw contents` opens the file in VS Code's default text editor. The extension's top info bar is not available there, but you can return to the viewer with `Open in Quick JSONL Viewer` from the editor title, Explorer context menu, or command palette.

## Development

```sh
npm install
npm test
```

`npm install` installs Husky hooks automatically. The pre-commit hook runs `npm test`.

Use VS Code's extension host launch flow to test the viewer manually with the small and large files in `sample-data/`.
