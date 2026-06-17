import fs from 'node:fs';
import path from 'node:path';

const dir =
  'C:/Users/dukky/.cursor/projects/c-Users-dukky-Documents-Development-Minnow/agent-transcripts/1ab42d10-d162-455f-ac29-4326d5c9e071/subagents';

const map = {
  'b731ac0a-ce29-42d3-810c-b8df38621eaf': 'MIN-176',
  '3ea8a7fc-4083-4928-8afd-bd1a8b265204': 'MIN-174',
  'b41cb09e-80fa-41e3-a60d-0ef22ae79747': 'MIN-173',
  'bc5bb8ae-d4d0-4edc-be3d-4e8792aaa431': 'MIN-172',
  '7580a504-ae55-4319-9743-43a52c3c93a2': 'MIN-171',
  '48118c61-bd26-47ca-9bef-7af43ddcdd99': 'MIN-170',
  '9b906deb-717e-4304-836e-22a558097da9': 'MIN-168',
  'f2a72fca-8d99-4276-b8eb-5a856247659f': 'MIN-167',
  '2f41bc1e-7f61-4265-9db1-767676bfbf13': 'MIN-166',
  '1ee5e4c9-96d4-4b73-8a49-6ea8a3fde05b': 'MIN-165',
  '26ae154f-f1a6-4492-b8b1-bf50d35584ff': 'MIN-164',
  'df015a6c-b955-4e2e-a5d8-6c4d3f118694': 'MIN-163',
  '7504df66-afc6-4782-abaf-21ef092472f4': 'MIN-162',
  'ee145b26-4096-4899-baf5-5254bc3a2831': 'MIN-161',
  'de73bd6a-d6e0-4be7-8b93-68c0bd78afea': 'MIN-160',
  'a45e24d5-8830-4ae6-b80e-d3e8353bc78a': 'MIN-159',
  'b8fc8c9a-4cd6-4088-97f2-0c9a52ec8f46': 'MIN-158',
  'e980f495-91bb-44cc-ba82-4507483597e8': 'MIN-157',
  'c47c67a1-08d7-41bf-9dee-175d366747b0': 'MIN-156',
  '9359839f-25b3-41ec-b74e-5147afd58705': 'MIN-154',
  '5b1f7584-dacc-4377-9f97-ce474f3fa261': 'MIN-132',
  '2992c82d-dd8e-4117-b0f9-08c1c7a6d49d': 'MIN-136',
  'e9c3bcf8-8a78-4096-9981-ad69a9073c20': 'MIN-134',
  '96cb8020-3362-4b36-8df8-057ffa68f240': 'MIN-133',
};

const out = {};
for (const [file, issue] of Object.entries(map)) {
  const lines = fs
    .readFileSync(path.join(dir, `${file}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .filter((l) => !l.includes('turn_ended'));
  const last = JSON.parse(lines[lines.length - 1]);
  const text = last.message.content[0].text;
  const m = text.match(/Recommended Linear Comment[\s\S]*?```markdown\n([\s\S]*?)```/);
  out[issue] = m ? m[1].trim() : text.slice(0, 4000);
}

const outPath = 'documentation/plans/bug-investigations/comments.json';
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Extracted', Object.keys(out).length, 'comments to', outPath);
