# Expert template reference

```yaml
---
id: my-expert          # lowercase slug: [a-z0-9][a-z0-9-]*
kind: expert            # required
label: My Expert        # dropdown label
version: 1
description: One-line summary for settings list
priority: 5             # higher wins ties
default: false          # true only for one fallback (e.g. general)
keywords:
  - keyword-one
  - keyword-two
negativeKeywords:
  - off-topic
regex:
  - "\\bSELECT\\b.+\\bFROM\\b"
classifierHint: When the user needs X, pick this expert.
---

[[EXPERT:my-expert]]

Body text here. The marker helps tests detect the expert part.
```

## Anti-patterns

- Do not use `kind: template` in production ids (prefix `_` for samples).
- Avoid huge keyword lists (slow scoring); prefer focused terms.
- Do not put secrets or API keys in expert bodies.
