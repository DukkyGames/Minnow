---
name: git-commit
description: >-
  Write conventional commit messages from staged diff context. Use when the user
  asks to commit or mentions git commit message.
disable-model-invocation: true
---

# Git commit helper

## When to use

- User asks for a commit message, `/git-commit`, or "commit these changes"
- Before committing, always inspect the **actual** staged diff

## Steps

1. Run `git_status` — confirm what is staged vs unstaged.
2. Run `git_diff` with `staged: true` (or equivalent args) — read the real patch.
3. If nothing is staged, tell the user to stage files with `git_add` first; do not invent a message for unstaged work.
4. Draft a **conventional commit** subject (≤72 chars) and optional body:
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
   - Subject: imperative mood, no trailing period
   - Body: explain *why*, not file lists
5. If the user asked you to commit, run `git_commit` with the agreed message only after explicit approval unless they already said "commit it".

## Quality checks

- Message matches the diff (no unrelated scope)
- No secrets, `.env`, or credentials in committed files — warn if diff shows them
- Breaking changes called out in body with `BREAKING CHANGE:`

## Tools

`git_status`, `git_diff`, `git_add`, `git_commit`, `git_log` (for style reference)
