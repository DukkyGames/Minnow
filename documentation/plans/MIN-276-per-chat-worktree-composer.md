# MIN-276 — Per-chat worktree + branch selector in composer

Status: **shipped** (branch `cursor/per-chat-worktree-composer-829b`).

## Summary

Regular chats can optionally run tool calls inside an isolated git worktree chosen from the composer (beside the mode selector). Board task chats continue to use MIN-275 board worktrees and hide these controls.

## Composer controls

1. **Run target** — Local (main workspace) or Worktree (attach existing / new worktree).
2. **Branch** — lists repo branches; checkout in Local mode; read-only label when a worktree is attached.

Icons: [`src/ui/git-worktree-icons.ts`](../src/ui/git-worktree-icons.ts) (local / branch / worktree).

## Persistence

| Field | Purpose |
|-------|---------|
| `Chat.worktreeRoot` | Absolute worktree path for tool cwd (shared with MIN-275 board chats) |
| `Chat.gitBranch` | Selected branch name |
| `Chat.chatWorktreeManaged` | Minnow-created slot — removed on chat delete / detach to Local |

## Server

- Paths: `~/.minnow/worktrees/<repoKey>/chat/<chatId>` — [`server/worktree/paths.js`](../server/worktree/paths.js)
- Ops: `create_chat`, `remove_chat` on `POST /api/worktree`

## Tests

- `test/state/chat-worktree.test.mts`
- `test/server/worktree-chat-ops.test.mjs`
