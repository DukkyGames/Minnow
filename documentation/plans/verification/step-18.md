# Step 18 verification — MCP + Context7

## Automated

```bash
npm run test:mcp
npm run build
```

Expected: **3/3** MCP tests pass.

## Seed check

After `npm start`, verify `~/.minnow/mcp.json` has `context7.enabled: true`.

## Fixture tool

```bash
curl -X POST http://localhost:5173/api/tools -H "Content-Type: application/json" -d "{\"name\":\"mcp__fixture__echo\",\"args\":{\"message\":\"x\"}}"
```

Expected: `{"result":"pong"}`.

Context7 live calls require `CONTEXT7_API_KEY` (deferred in CI).
