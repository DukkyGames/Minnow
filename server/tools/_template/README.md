# Tool plugin template

Place custom tool packs under `~/.minnow/tools/<id>/` with:

- `tool.json` — metadata and JSON Schema parameters
- `handler.mjs` — `export default async function handler(args, ctx)`

Scaffold from Minnow: `POST /api/plugins/scaffold` with `{ "id": "your-plugin-id" }` while `npm start` is running.

Authoring guide: `documentation/plugins/tool-authoring.md`
