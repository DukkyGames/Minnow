---
name: ask-user
description: >-
  Gather structured answers from the user with the ask_question tool when requirements,
  scope, or priorities are ambiguous. Use for /ask-user before large plans or multi-feature work.
disable-model-invocation: false
---

# Ask user (structured questions)

## When to use

- Requirements are unclear or conflicting and you need a decision to proceed safely.
- Multiple features or options need prioritization or MVP scope.
- Trade-offs (performance vs simplicity, breadth vs depth) should be explicit before planning.

## How to use `ask_question`

1. Batch related questions in **one** tool call when possible (up to 10 questions).
2. Each question needs at least **two preset options** with stable `id` values and short `label` text; add a one-line `description` when choices need nuance.
3. Use **`allow_multiple: true`** only when several non-exclusive answers are valid.
4. The client always adds an **Other** row with free text; reserve the id `__other__` for the model (do not use it in preset options).
5. After the user **cancels**, do not invent answers: ask briefly in chat or state labeled assumptions.

## When not to use

- Facts you can verify from the workspace (`read_file`, search, git status).
- Purely stylistic or trivial preferences unless the user asked for options.

## Reef module save (preset)

When a Reef widget is worth reusing, confirm before writing `~/.minnow/reef/modules/<slug>.md`:

```json
{
  "questions": [
    {
      "id": "save_reef_module",
      "prompt": "Save this widget as a reusable module in your Minnow library?",
      "options": [
        { "id": "yes", "label": "Yes, save to my Minnow library" },
        { "id": "no", "label": "No, keep only in this chat" }
      ]
    }
  ]
}
```

On **no** or **cancelled**, do not call `write_file` for that module. On **yes**, write only to `@minnow/reef/modules/<slug>.md` (sanitized slug; ask again if the file already exists).

## Mode-handoff presets (`propose_mode_switch`)

When offering **Plan → Orchestrate**, **Build ↔ Plan**, or **Reef widget** choices, prefer **`propose_mode_switch`** with:

| `situation` | When |
|-------------|------|
| `plan_complete` | Plan file saved; offer Orchestrate new chat / stay / Build |
| `implement_in_wrong_mode` | User wants code in Plan or Research |
| `plan_in_build` | User wants a plan document in Build |
| `reef_visualization` | Topic suits an interactive widget (not already Reef) |

After answers, call **`create_chat_with_mode`**, **`set_chat_mode`**, or **`spawn_sub_agent`** (`reef-widget`) per the mode-handoff prompt rules.

## After answers

Summarize what was chosen in one short paragraph, then continue with the task or plan.
