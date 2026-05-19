# Thought bubbles and per-message Thoughts panel

Implemented plan: live reasoning UI, persistence, and history restore.

## Todos (implementation)

- [x] Extend `src/types.ts`: `ChatCompletionChoiceDelta` / `message` reasoning fields; `AssistantMessage.thinking?: string[]`.
- [x] Add `src/api/reasoning.ts`: `extractReasoningDelta`, `extractReasoningMessage`, `splitThinkingSegments`; re-export from `src/api/chat.ts`.
- [x] Add `src/ui/thought-bubbles.ts` + `src/styles/thoughts.css`; import CSS from `src/main.ts`.
- [x] Wire `src/tools/loop.ts`: `ThoughtBubbleController` per send, `streamCompletionTurn` reasoning + content handling, `setAssistantWrap` on tool rounds, fallback `ingestCompletedReasoning`, final `thinking` + `renderThoughtsToggle`, `abort` in `finally`.
- [x] Wire `src/api/chat.ts` `sendMessage` (plain path): same controller pattern + fallback + toggle.
- [x] Wire `src/ui/messages.ts` `renderChatFromHistory` for stored `thinking`.
- [x] Update `documentation/context.md`; this plan file.

## Prerequisites (users)

- LM Studio **App Settings → Developer**: enable separated reasoning (`reasoning_content` / `delta.reasoning`) when using a reasoning-capable model.
- Without that, SSE may omit separate reasoning fields; the UI then shows no live bubbles and no **Thoughts** button.

## Key files

| Area | File |
|------|------|
| Types | [`src/types.ts`](../src/types.ts) |
| SSE parsing | [`src/api/reasoning.ts`](../src/api/reasoning.ts), [`src/api/chat.ts`](../src/api/chat.ts) (`extractStreamDelta` unchanged for prose) |
| UI | [`src/ui/thought-bubbles.ts`](../src/ui/thought-bubbles.ts), [`src/styles/thoughts.css`](../src/styles/thoughts.css) |
| Tool loop | [`src/tools/loop.ts`](../src/tools/loop.ts) |
| Plain send | [`src/api/chat.ts`](../src/api/chat.ts) `sendMessage` |
| History | [`src/ui/messages.ts`](../src/ui/messages.ts) |

## Manual test checklist

1. Reasoning model + LM Studio developer setting on: live bubbles typewriter; `\n\n` starts new thought; prose removes live stage; **Thoughts** expands segments after reply.
2. Non-reasoning model: no bubbles, no button.
3. Tool loop: tool bubbles unchanged; reasoning across turns rolls into final assistant `thinking`.
4. Reload session: **Thoughts** restores collapsed.
5. Abort mid-stream: no stuck timers / orphan nodes.
