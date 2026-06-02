---
command: npm run dev
cwd: .
healthUrl: http://localhost:5173/
port: 5173
stop:
  command: npx kill-port 5173
---

# Startup guide

Human-readable notes for agents: how this repo expects the dev server to run,
common environment variables, and troubleshooting tips.

The Vibe Hub **Dev server** cell can override **port** and **network** (this PC vs LAN)
per workspace; those settings merge at start time and do not require editing this file.
