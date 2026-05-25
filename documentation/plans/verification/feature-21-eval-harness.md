# Feature 21 — Local eval harness — Manual QA

**Issue:** MIN-57 · **Settings route:** `#/settings/evals`

## Prerequisites

- `npm start` (tool server + `/api/evals/*`)
- LM Studio or another provider configured under Settings → Providers
- Workspace folder open (for read-only coding-smoke tasks)

## Checklist

### Packs

- [ ] Settings → Evals → **Packs** lists built-in **Coding smoke tests** (`coding-smoke`)
- [ ] **View JSON** shows two tasks with `list_directory` / `search_in_file` allowlists
- [ ] **Copy to user packs** creates `coding-smoke-custom` under `~/.minnow/evals/packs/`
- [ ] Edit + **Save** user pack; reload still shows override

### Run

- [ ] **Run** tab: select `coding-smoke`, add at least one model target (provider id + model id)
- [ ] **Start suite** shows progress (`completed / total`)
- [ ] Suite completes without polluting active chat history
- [ ] **Abort** cancels in-flight suite (partial cells retained when persistence on)

### Results

- [ ] **Results** lists suite run with status and cell counts
- [ ] **Leaderboard** shows per-model mean score, pass rate, median duration
- [ ] **Download JSON** exports manifest + leaderboard

### API / disk

- [ ] `curl http://localhost:5173/api/evals/ping` → `{"ok":true}`
- [ ] `~/.minnow/evals/runs/<suiteRunId>/manifest.json` exists after run
- [ ] `~/.minnow/evals/runs/<suiteRunId>/cells/*.json` contain grader scores

### Automated

```bash
npx tsc --noEmit
npm run test:evals
```
