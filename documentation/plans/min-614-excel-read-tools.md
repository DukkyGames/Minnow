# MIN-614 — Agent Excel file reading tools

## Problem

Attaching or opening an Excel workbook (`.xlsx`) in chat made agents report that file tools were broken. Typical call:

```json
{ "path": "Comission Structure.xlsx" }
```

The result was the raw ZIP payload (`PK…`) because `read_file` always decoded the file as UTF-8. `.xlsx` is a ZIP package, so the model saw binary garbage instead of sheet text.

`read_document` already extracts Excel/Word/PDF, but:

1. Agents almost always call `read_file` (and workspace chips resolved through `read_file`).
2. Work-agent / sub-agent allowlists often omitted `read_document`.
3. Prompts told models to prefer `read_file` without mentioning office files.

## Approach

- **`read_file` / `read_file_range`** detect PDF/office paths and extract via `read_document` instead of UTF-8.
- **Binary sniff:** other files with NULs in the first 8 KiB return a clear error (do not dump garbage).
- **Workspace chips** for Excel/PDF/Word call `read_document` on send.
- **Prompts + allowlists** expose `read_document` next to `read_file`.

## Todos

- [x] Route `read_file` / `read_file_range` through document extraction for office/PDF
- [x] Reject generic binary files instead of UTF-8 dumping them
- [x] Resolve workspace attachment chips with `read_document` for office/PDF
- [x] Update tool schemas, tool-usage prompts, work-agent and sub-agent allowlists
- [x] Tests: xlsx via `read_file`, binary sniff, workspace-ref routing, extensions helper
- [x] Update `documentation/context.md`

## Out of scope

Password-protected workbooks, `.csv` (already UTF-8 text), changing the file viewer.
