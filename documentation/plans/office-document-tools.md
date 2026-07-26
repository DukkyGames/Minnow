# Office document tools and file preview

**Status:** Implemented  
**Related:** [`documentation/context.md`](../context.md) (attachments), MIN-32 `read_document`

## Summary

Agents can create PDF, Excel, and Word files with first-class tools instead of shelling out to Python. The file viewer previews those formats read-only in the split pane.

## Tools

| Tool | Output | Key args |
|------|--------|----------|
| `create_pdf` | `.pdf` | `path`, `body`, optional `title` |
| `create_spreadsheet` | `.xlsx` | `path`, `sheets[]` with `name?` and `rows[][]` |
| `create_word_document` | `.docx` | `path`, `sections[]` (`heading` / `paragraph`), optional `title` |

All three are in the `files-write` tool group. Plan mode blocks them (same as other binary writes).

## Dependencies

| Package | Used for |
|---------|----------|
| `pdf-lib` | `create_pdf` |
| `xlsx` | `create_spreadsheet`, spreadsheet preview |
| `docx` | `create_word_document` |
| `mammoth` | `.docx` HTML preview |
| `officeparser` | legacy `.doc` preview fallback |
| `pdf-parse` | `read_document` PDF extraction |

All six are listed in `package.json` `dependencies` and install with `npm install`.

## File viewer preview

| Extension | View mode | Route |
|-----------|-----------|-------|
| `.pdf` | embed (blob URL; avoids Chromium iframe PDF block) | `GET /api/preview/file/…` → client blob |
| `.xlsx`, `.xls`, `.ods`, … | iframe (HTML tables) | `GET /api/preview/document-html/…` |
| `.docx`, `.doc`, … | iframe (HTML) | `GET /api/preview/document-html/…` |

## Todos

- [x] Server tools (`server/tools/create-document.js`)
- [x] Tool definitions + `files-write` group
- [x] Preview API (`/api/preview/document-html/*`)
- [x] File viewer routing + styles
- [x] Tests + `context.md`

## Future ideas

- Richer PDF layout (tables, images)
- Append rows to existing spreadsheets
- In-viewer “Open externally” for Office files on desktop
