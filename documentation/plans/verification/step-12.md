# Step 12 verification — CDP browser automation

## Automated

```bash
npm run test:browser
```

Or:

```bash
node --test test/cdp/allowlist.test.js test/browser-cdp.test.mjs
```

**Expect:** all tests pass without real Chrome.

## Build

```bash
npm run build
```

## Manual (optional)

1. Start Chrome with remote debugging:

   ```bash
   # Windows
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
   ```

2. `npm start` — enable **Browser (CDP)** tools in Settings.

3. In chat, ask the model to run `browser_list` — should list tabs.

4. `browser_navigate` to `http://127.0.0.1:5173/` → `browser_screenshot` — inline image in tool bubble.

5. `browser_navigate` to `https://evil.example` — tool result starts with `Error: navigation blocked`.

## PASS criteria

- [ ] `npm run build` succeeds
- [ ] `npm run test:browser` all green
- [ ] `documentation/context.md` lists 39 tools + screenshot route
- [ ] Inline screenshot in chat (manual once)
