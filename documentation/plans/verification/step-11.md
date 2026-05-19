# Step 11 verification — File tree + split viewer

## Prerequisites

- `npm start` (Vite + `/api/tools` + `/api/config/*`)
- LM Studio optional for file UI

## Automated

```bash
npm run build
npm test
npm start
# separate terminal:
node scripts/step-11-smoke.mjs http://localhost:5173
node --test test/file/list-directory-parse.test.mjs
```

## Manual QA

| ID | Steps | Expected |
|----|--------|----------|
| M1 | Click top-bar **Files** | Right file sidebar opens; project tree root |
| M2 | Expand `src` | Children load; chevron rotates |
| M3 | Click `package.json` | Split opens; JSON highlighted |
| M4 | Drag split resizer | Widths change; ratio restored on reload (`npm start`) |
| M5 | Collapse file sidebar | Narrow rail; viewer stays if open |
| M6 | Close viewer | Viewer hides; chat full width |
| M7 | `npm run dev` only | Sidebar opens; `npm start` message; no crash |
| M8 | Mobile ≤640px | Overlay + backdrop; Escape closes |
| M9 | Open large file (e.g. `package-lock.json`) | Range banner; UI responsive |
| M10 | Path traversal via UI | Server error; friendly viewer message |

## PASS criteria

- Build and unit tests pass
- Smoke script all PASS
- Manual M1–M8 checked; M9–M10 best-effort
