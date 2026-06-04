# Expert template reference

```yaml
---
id: my-expert          # lowercase slug: [a-z0-9][a-z0-9-]*
kind: expert            # required
label: My Expert        # picker label
description: One-line summary for the picker tile
tagline: Short subtitle under the label
greeting: Opening line when the expert is summoned
icon: "🎯"              # optional emoji or 1–2 char glyph
accent: sage            # sage | amber | cyan | coral | violet | rose
---

[[EXPERT:my-expert]]

Body text here. The marker helps tests detect the expert part.
```

## Anti-patterns

- Do not use `kind: template` in production ids (prefix `_` for samples).
- Do not put secrets or API keys in expert bodies.
- Do not add routing fields (`keywords`, `regex`, `negativeKeywords`, `classifierHint`, `priority`, `default`) — Experts are summoned manually from the Experts page.
