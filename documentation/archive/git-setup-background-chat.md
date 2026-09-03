# Git setup as a background chat

**Status:** Implemented  
**Source:** Cursor plan `git_setup_background_chat_38c1d1a5`

Replace the **Set up git** composer-prefill with a background `/git-setup` chat that auto-runs without stealing focus. Covers Source Control Center, the sidebar git panel, and Code overview.

Orchestrate board onboarding stays on programmatic `initializeWorkspaceGit` (MIN-615). That path is out of scope.

## Todos

- [x] Write this plan with the same todos
- [x] Add `src/chat/git-setup-background.ts`: `ensureBackgroundChat` + `sendProgrammaticChatText`, no `activeId` steal, reuse/streaming guards, post-turn git refresh
- [x] Point git-no-repo-state default CTA at the launcher; remove `prefillGitSetupComposer` and `openGitSetupFromOverview`; drop Code overview override
- [x] Add `test/chat/git-setup-background.test.mts` for key, reuse, no-focus, streaming guard, prompt
- [x] Update `documentation/context.md` and `documentation/manual/apps/code.md`
- [ ] Verify SCC, git panel, and Code overview in a **non-git** folder (this repo is already a git workspace; no in-session browser MCP). Unit tests cover the CTA not prefilling `#msgInput`.

## Current behavior

`src/ui/git-no-repo-state.ts` is the shared empty state for a workspace that is not a git repo. **Set up git** writes this into the Code composer and focuses it:

```text
/git-setup Initialize git in this workspace (init, .gitignore, initial commit).
```

Callers:

- Source Control Center (`src/ui/source-control-center.ts` `setNoRepo`) — default handler
- Sidebar git panel (`src/ui/git-panel.ts` `setGitPanelNoRepoState`) — default handler
- Code overview (`src/ui/code-overview.ts` `renderNoGitRepository`) — closes overview, navigates to Code chat, then prefills

Nothing is sent. The user is pulled into a chat (or a hidden composer under SCC) and has to press Send.

## New behavior

Click **Set up git** on any of those three surfaces:

1. Stay on the current surface (SCC / git panel / overview). Do **not** assign `sessionState.activeId` (MIN-637).
2. Create or reuse a background chat keyed by workspace: `git-setup:<normalizedWorkspacePath>`.
3. Auto-send the same `/git-setup` prompt via `sendProgrammaticChatText` with `ownsGlobalStreaming: false`.
4. Toast: “Setting up git in the background”. The chat shows in the sidebar; unread / “needs you” if the skill later asks GitHub questions via `ask_question`.
5. If that chat is already streaming, toast “Git setup is already running” and do not start a second turn.

Git surfaces already poll (SCC 5s, git panel, Code overview slow timer), so the no-repo overlay goes away once `git init` lands. After the turn settles, still force a refresh of SCC + git panel and invalidate the composer-undo git cache.

## Implementation notes

- Launcher: `src/chat/git-setup-background.ts`
- Prompt text stays the same so skill behavior is unchanged (`prepareGitSetupTurn` still runs inside `runChatTurn` when `skillId === git-setup`).
- Button: disable and label **Setting up…** while launch is in flight or the background chat is streaming.
