---
command: npm run dev
cwd: .
healthUrl: http://localhost:3000/
port: 3000
# When package.json `dev` uses concurrently (API + Vite), Minnow routes the UI port above
# to the client script and sets PORT for the API. Override API bind with apiPort:
# apiPort: 3001
stop:
  command: npx kill-port 3000
---

# Startup guide

Human-readable notes for agents: how this repo expects the dev server to run,
common environment variables, and troubleshooting tips.

The Vibe Hub **Dev server** cell can override **port** and **network** (this PC vs LAN)
per workspace; those settings merge at start time and do not require editing this file.
