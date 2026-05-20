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

## After answers

Summarize what was chosen in one short paragraph, then continue with the task or plan.
