---
id: ask-question-enforcement
kind: tool-usage
label: Ask question enforcement (lite)
version: 1
part: tool-usage
---

**Choices = `ask_question` only.** Never list A/B/C or numbered options in prose. Use `{ questions: [{ id, prompt, options: [{ id, label }, …] }] }`. Mode handoff → `propose_mode_switch`. Browser origins → `ask_question` then `request_browser_origin_access`.
