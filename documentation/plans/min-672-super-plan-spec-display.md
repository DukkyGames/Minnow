---
name: min-672-super-plan-spec-display
overview: Fix Super Plan so the build spec appears as soon as the spec_confirm checkpoint is reached, without requiring a plan switch or reload.
todos:
  - id: fix-readable-paths
    content: Treat spec/plan/research paths as readable only after the matching stage has written them
    status: done
  - id: fix-paint-body
    content: Stop caching empty spec reads; retry with cache-bust; remount when content changes
    status: done
  - id: tests
    content: Cover hidden Spec tab during write and recovery after an empty first read
    status: done
  - id: docs
    content: Update documentation/context.md Super Plan notes
    status: done
  - id: verify
    content: Run scoped Super Plan UI tests and tsc
    status: done
isProject: false
---

# MIN-672 — Super Plan build spec does not show until reload

## Goal

When Super Plan reaches **Confirm the build spec**, the Spec column must show the written build spec immediately. Switching to another plan and back, or reloading, must not be required.

## Why it fails

Two races in [`src/ui/super-plan-page.ts`](../../src/ui/super-plan-page.ts):

1. **Reserved path is treated as a file.** `createSuperPlanState` sets `specPath` / `planPath` / `researchPath` at pipeline start. `specPathOf` falls back to that reserved path, so the **Spec** tab is clickable during Interview / while the spec is still being written. Opening it calls `readPlanArtifactMarkdown`, which 404s and returns `''`.

2. **Empty reads are cached as final.** `paintBody` stores `''` in `docCache`. Later paints see a cache hit and skip remount when `dataset.path` already matches. The real file can land a moment later; the column stays empty until `retarget` (switch plan) or a full reload clears the cache.

The same pattern can hide the Plan column if someone opens **Plan** before the first draft save.

## Approach

- **Readable artifacts only.** `specPathOf` / `planPathOf` / `researchPathOf` return a path when the stage has `artifactPath`, or when the stage is `blocked_user` / `done` (legacy rows without `artifactPath`). Reserved paths are not enough.
- **Do not cache empty.** Retry empty/failed preview reads with backoff and a cache-bust query so a stale HTTP 404 cannot stick.
- **Remount on content signature**, not path alone, so a retry that finally gets markdown replaces the empty placeholder.
- **Ignore stale fetches** after retarget or a newer request (`docFetchId`).
- **Drop cache** when a spec/plan path goes away (revise / rewind) so the next write is fetched fresh.

## Tests

In `test/ui/super-plan-page.test.mts`:

- Spec tab stays hidden during grill / spec_confirm `running` even when `specPath` is reserved.
- Spec checkpoint shows the Spec segment and mounts markdown from the preview fetch.
- First preview 404, then 200 → spec body appears without switching plans.

## Out of scope

- Changing how the controller writes or names the spec file.
- Orchestrate overlay preview (Super Plan uses the library page, not that overlay).
