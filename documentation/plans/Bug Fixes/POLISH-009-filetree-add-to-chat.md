---
name: POLISH-009 — File tree Add to chat
overview: Add a file-tree context menu action that attaches the selected file to the composer using the existing workspace-reference chip pipeline (same as drag-and-drop).
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-009)
status: verified-not-shipped
related:
  - POLISH-008 (editor selection → Add to chat)
  - POLISH-013 (context menu → Report bug)
todos:
  - id: shared-attach-helper
    content: Extract attachWorkspacePathToComposer(path) shared by composer-drop and file-tree menu (Orchestrate plan path + addWorkspaceReference)
    status: pending
  - id: file-menu-item
    content: Add "Add to chat" to buildFileMenuItems in file-tree-context-menu.ts (files only; always enabled when row is shown)
    status: pending
  - id: orchestrate-parity
    content: Mirror composer-drop Orchestrate plan handling via applyOrchestratePlanFromWorkspacePath before workspace chip
    status: pending
  - id: tests
    content: Unit tests for shared helper and menu wiring; optional jsdom click test on context menu
    status: pending
  - id: docs-context
    content: Update documentation/context.md file-panel section when shipped (context menu Add to chat)
    status: pending
  - id: manual-verify
    content: Manual QA checklist — chip, dedup, Orchestrate plan drop, offline tree, large file warn on send
    status: pending
isProject: false
---

# POLISH-009 — File tree context menu: Add to chat

**Audit ref:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — **POLISH-009** (Requested).  
**Architecture ref:** [context.md](../../context.md) — File panel (workspace), drag-to-composer, attachments.

**Scope:** Plan only — no implementation in this document.

---

## Summary

Users can already **drag a file row** from the project tree onto the composer to queue a **workspace reference** chip (`kind: workspace`). This polish item adds the same outcome via **right-click → Add to chat** on **file** rows in the sidebar tree, matching IDE patterns (Cursor / VS Code) and complementing **POLISH-008** (selection inside the open editor).

---

## Desired behavior

| Action | Result |
|--------|--------|
| Right-click a **file** in `#fileTreeHost` | Context menu includes **Add to chat** |
| Choose **Add to chat** | Composer `#attachPreview` gains a workspace chip for that project-relative path (deduped by path) |
| Send message | Existing send path: `resolveWorkspaceReferences()` → `read_file` → text attachment; `largeTextWarning` if content **> 32 KB** |
| **Folders** | **Not supported** in v1 — item omitted from folder menu (or shown disabled with clear title) |
| **Orchestrate + plan file** | Same as drag-drop: executable plan under `documentation/plans/` sets `chat.orchestratePlanPath` instead of a chip when mode is Orchestrate |

**Non-goals for v1**

- Pre-reading file content into the chip at menu click (chips stay path-only until send).
- Attaching entire directories or globs.
- New attachment kind or API shape — reuse `workspace` attachments only.

---

## Current state

| Capability | Status | Location |
|------------|--------|----------|
| Drag file row → composer chip | **Shipped** | [`src/ui/file-tree.ts`](../../../src/ui/file-tree.ts) `wireTreeRowDrag` sets `WORKSPACE_FILE_MIME` + `text/plain` |
| Drop handler | **Shipped** | [`src/ui/composer-drop.ts`](../../../src/ui/composer-drop.ts) → `addWorkspaceReference` or `applyOrchestratePlanFromWorkspacePath` |
| Workspace chip queue + dedupe | **Shipped** | [`src/attachments/workspace-ref.ts`](../../../src/attachments/workspace-ref.ts) `addWorkspaceReference` |
| Resolve on send | **Shipped** | `resolveWorkspaceReferences` in workspace-ref; called from [`src/tools/loop.ts`](../../../src/tools/loop.ts) |
| File tree row context menu | **Shipped** | [`src/ui/file-tree-context-menu.ts`](../../../src/ui/file-tree-context-menu.ts) — Open / Cut / Copy / Paste / Rename / Delete |
| **Add to chat** on tree | **Missing** | No menu item; no shared “attach path” helper exported for reuse |

**Drag path (reference):**

```121:128:src/ui/file-tree.ts
  row.addEventListener('dragstart', (event) => {
    // ...
    transfer.setData(WORKSPACE_FILE_MIME, fullPath);
    transfer.setData('text/plain', fullPath);
  });
```

**Drop path (reference):**

```66:77:src/ui/composer-drop.ts
  element.addEventListener('drop', (event) => {
    // ...
    const path = pathFromDataTransfer(event.dataTransfer!);
    if (path) {
      if (!applyOrchestratePlanFromWorkspacePath(path)) {
        addWorkspaceReference(path);
      }
    }
  });
```

---

## Gap

| User expectation | Today |
|------------------|--------|
| Right-click file → **Add to chat** | Only drag-and-drop or manual paperclip (OS files, not tree paths) |
| Discoverable parity with other IDEs | Tree CRUD menu exists; no chat bridge |

---

## Design decisions

### 1. Reuse workspace-reference pipeline (no new attachment type)

**Add to chat** must call the same logic as a successful composer drop: queue `kind: 'workspace'` with `workspacePath`, show `.attach-chip--workspace`, load body on send via `read_file`. Do not inline file text at click time.

**Rationale:** Matches existing UX copy (“content loads when you send”), token estimate refresh via `renderAttachPreview`, and permission/approval gates on `read_file` at send time.

### 2. Shared helper (DRY with composer-drop)

Introduce a small exported function (name suggestion: `attachWorkspacePathToComposer`) used by:

- [`src/ui/composer-drop.ts`](../../../src/ui/composer-drop.ts) (drop handler)
- [`src/ui/file-tree-context-menu.ts`](../../../src/ui/file-tree-context-menu.ts) (menu action)

**Behavior:**

```ts
// Pseudocode — implement in workspace-ref.ts or composer-drop.ts
function attachWorkspacePathToComposer(workspacePath: string): void {
  const path = workspacePath.trim();
  if (!path) return;
  if (!applyOrchestratePlanFromWorkspacePath(path)) {
    addWorkspaceReference(path);
  }
  scheduleContextUsageRefresh(); // already triggered by pushAttachment → renderAttachPreview; only if helper bypasses store
}
```

Prefer colocating with **composer-drop** or **workspace-ref** so Orchestrate import stays in one UI layer; avoid importing Orchestrate from `file-tree-context-menu` directly if the helper centralizes it.

### 3. Menu placement and labeling

- **Files:** Insert **Add to chat** immediately after the **Open** / **Open as code** block and before **Cut** (groups “open/view” vs “send to agent” vs “filesystem CRUD”).
- **Label:** `Add to chat` (sentence case, matches bug-hunt and POLISH-008 wording).
- **Folders:** **Omit** the item from `buildFolderMenuItems` in v1 (simplest; avoids ambiguous “attach directory” semantics). Document in QA that folder right-click has no Add to chat.

### 4. Enabled when server is “offline” for CRUD

Tree row menus today disable Cut/Rename/etc. when `!isFileTreeServerAvailable()`. **Add to chat** should **not** follow that gate:

- Queuing a path does not call `executeTool` until send.
- User may still want to stage files while browsing is degraded (edge case); if the tree shows no rows (true offline empty state), the menu is unreachable anyway.

**Open** may stay server-gated; **Add to chat** is independent.

### 5. Orchestrate plan files

When the active chat is **Orchestrate** and the path is an **executable plan** (`applyOrchestratePlanFromWorkspacePath` returns true), do **not** add a workspace chip — update `chat.orchestratePlanPath` and refresh the plan strip (same as drop). Prevents duplicate plan selection UX.

### 6. Workspace scope and large files

- Paths are already project-relative strings from the tree (`data-path` on rows).
- Boundary checks remain on **`read_file`** at send (server `safe-path` / workspace root).
- Soft **32 KB** warning applies after resolve (`largeTextWarning`), not at menu click — no change required for POLISH-009.
- **10 MB** attachment cap applies to paperclip `File` objects, not workspace refs — document in QA only.

### 7. Composer focus (optional polish)

After **Add to chat**, optionally `document.getElementById('msgInput')?.focus()` (pattern exists in approval/question modals). **Recommendation:** include in v1 for discoverability; low risk.

### 8. Distinction from POLISH-008

| | POLISH-009 (this) | POLISH-008 |
|--|-------------------|------------|
| Source | File tree row | Editor selection |
| Attachment | Whole file via path | Snippet + path + line range |
| Pipeline | `workspace` → resolve full file | Likely new `text` chip or fenced block in composer |

Implementations should not share one menu builder, but may share composer focus / status feedback patterns.

---

## Implementation plan

### Step 1 — Shared attach helper

1. Add `attachWorkspacePathToComposer(workspacePath: string): void` next to drop logic.
2. Refactor `composer-drop.ts` drop handler to call the helper.
3. Export for tests.

### Step 2 — Context menu item (files only)

In [`buildFileMenuItems`](../../../src/ui/file-tree-context-menu.ts):

1. After `openItems`, append:

   ```ts
   {
     label: 'Add to chat',
     action: () => attachWorkspacePathToComposer(ctx.path),
   },
   ```

2. Do **not** add to `buildFolderMenuItems` or `buildBackgroundMenuItems`.

No changes required to [`wireRowContextMenu`](../../../src/ui/file-tree.ts) beyond what the menu builder already receives via `buildMenuContext`.

### Step 3 — Tests

| Test | Intent |
|------|--------|
| `attachWorkspacePathToComposer` | Calls `addWorkspaceReference` when Orchestrate helper returns false; does not double-add when deduped |
| Orchestrate branch | Mock `getActiveChat` + `applyOrchestratePlanFromWorkspacePath` — plan path updates, no `pushAttachment` |
| Menu composition (optional) | Export `buildFileMenuItemsForTest` or test via shallow DOM: contextmenu on rendered row includes **Add to chat** |

Suggested files:

- Extend [`test/workspace-ref.test.ts`](../../../test/workspace-ref.test.ts) or new `test/ui/attach-workspace-to-composer.test.mts`
- If menu labels are tested, `test/file/file-tree-context-menu.test.mjs` with jsdom + mocked server flag

### Step 4 — Documentation (on ship)

Update [context.md](../../context.md) **Phase 2 — drag to composer** bullet to mention context menu **Add to chat** as an equivalent entry point.

---

## Manual verification checklist

- [ ] `npm start`, expand tree, right-click `src/foo.ts` → **Add to chat** → chip shows path; tooltip “loads when you send”.
- [ ] Second **Add to chat** on same file → single chip (dedupe).
- [ ] Send → user message includes `<file>` content; large file shows “(large file)” chip / warning path.
- [ ] Drag same file still works; drop and menu produce identical chips.
- [ ] Orchestrate mode: drop/menu on `documentation/plans/.../*.md` plan → plan strip updates, no workspace chip.
- [ ] Folder right-click: no **Add to chat** (or disabled with explanation if product chooses disabled state).
- [ ] Path outside workspace at send → error chip on resolve (existing behavior).
- [ ] `npm run dev` (no tool server): if tree empty, N/A; if tree cached from prior session, behavior documented.

---

## Files likely touched

| File | Change |
|------|--------|
| [`src/ui/composer-drop.ts`](../../../src/ui/composer-drop.ts) | Extract + use `attachWorkspacePathToComposer` |
| [`src/attachments/workspace-ref.ts`](../../../src/attachments/workspace-ref.ts) | *Alternative* home for helper if it keeps Orchestrate out of attachments layer |
| [`src/ui/file-tree-context-menu.ts`](../../../src/ui/file-tree-context-menu.ts) | **Add to chat** item in `buildFileMenuItems` |
| `test/...` | Unit tests per Step 3 |
| [`documentation/context.md`](../../context.md) | One-line UX note when shipped |

**Explicitly not in scope:** `file-tree.ts` row wiring (unless tests need exports), `file-viewer.ts` (POLISH-008), attachment types, server APIs.

---

## Risks and edge cases

| Risk | Mitigation |
|------|------------|
| Duplicate logic vs drop | Single helper (Step 1) |
| User expects folder attach | Omit folder item; revisit only if product requests zip/list_dir semantics |
| Binary / image files inlined as text on send | Existing `read_file` behavior; no change in POLISH-009 |
| Mobile long-press context menu | Same `contextmenu` event as desktop; no extra work unless QA finds gaps |

---

## Related backlog

- **POLISH-008** — Editor selection **Add to chat** (different payload).
- **POLISH-013** — **Report bug** on same menus (parallel context-menu work).
- **Bug hunt table** — [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) § POLISH-009.

---

## Open questions (resolve before or during implementation)

1. **Folder menu:** Omit entirely (recommended) vs disabled row with `title="Folders cannot be added to chat"`?
2. **Composer focus:** Always focus `#msgInput` after attach, or only when file panel is open?
3. **Status toast:** Drag-drop does not call `setStatus`; confirm menu should also stay silent (recommended: silent + chip only).

Default answers if no product input: **(1) omit**, **(2) focus composer**, **(3) silent**.

---

## Verification log (2026-05-24)

**Result: not shipped** (codebase audit; no implementation branch after review window).

| Criterion | Status |
|-----------|--------|
| Plan matches current gap in `file-tree-context-menu.ts` | Pass |
| Prerequisite drag-drop → workspace chip | Pass (shipped) |
| **Add to chat** in file row context menu | **Fail** |
| `attachWorkspacePathToComposer` helper + composer-drop refactor | **Fail** |
| Unit / menu tests | **Fail** |
| `context.md` documents context-menu entry | **Fail** |

**Linear:** [MIN-78](https://linear.app/minnowai/issue/MIN-78/polish-009-file-tree-add-to-chat) — Todo, priority Low, labels `polish`, `files`.

**File menu today** (`buildFileMenuItems`): Open (± Open as code) → Cut → Copy → Paste → Rename → Delete — no chat bridge.


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-78](https://linear.app/minnowai/issue/MIN-78/polish-009-file-tree-add-to-chat)
