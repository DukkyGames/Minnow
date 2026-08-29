---
name: min-627-delete-rule-groups
overview: Let Settings → Rules delete empty rule groups, while blocking deletes that would silently drop or reassign rules.
todos:
  - id: core-delete-fn
    content: Add removeUserRuleGroup that blocks non-empty groups and the last remaining group
    status: completed
  - id: settings-ui
    content: Add Delete group on Settings → Rules group headers with confirm / cannot-delete alert
    status: completed
  - id: catalog-search
    content: Add searchable Delete rule group catalog field and regenerate the settings registry
    status: completed
  - id: tests
    content: Cover the delete helper, Settings UI, and rules.json PUT omitting an empty group
    status: completed
  - id: docs
    content: Update context.md, settings reference, and the user manual
    status: completed
  - id: verify
    content: Run scoped tests, typecheck, and verify the Settings → Rules flow in the browser
    status: in_progress
isProject: false
---

# MIN-627 — Cannot delete rule groups

## Goal

From **Settings → Rules**, delete a rule group. Empty groups stay gone after reload. Groups that still have rules cannot be deleted; the error says why. Rules in other groups are left untouched.

## Why it fails

[`src/ui/settings-rules.ts`](../../src/ui/settings-rules.ts) can add groups and add/edit/delete individual rules. There is no delete control on a group. Saving a blob that omitted a group with remaining rules would also be unsafe: [`normalizeUserRules`](../../src/config/user-rules.ts) remaps unknown `groupId`s onto the first remaining group.

## Approach

- Single helper `removeUserRuleGroup` owns the policy:
  - Missing group → error.
  - Group still has rules → error with count; do not strip or reassign those rules.
  - Last remaining group → error. `normalizeUserRules` / server `validateUserRulesSettings` recreate **General** when `groups` is empty, so a last-group delete would not stay gone.
  - Otherwise drop only that group; copy `rules` unchanged.
- Settings UI: **Delete group** on each group header when more than one group exists. Confirm empty deletes. `appAlert` for blocked deletes.
- Persist through the existing `PUT /api/config/rules` blob. No second composer-only manager.

## Acceptance

- Empty extra group can be deleted and is absent after reload.
- Non-empty group cannot be deleted; message explains that its rules must be moved or deleted first.
- Rules attached to other groups keep the same ids, text, and `groupId`.
