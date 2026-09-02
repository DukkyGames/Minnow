
const base = process.argv[2]?.replace(/\/$/, '') ?? 'http://localhost:5173';

async function req(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const rows = [];

async function run() {
  const ping = await req('GET', '/api/memory/ping');
  rows.push(['ping', ping.status === 200 && ping.json.ok === true]);

  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const create = await req('POST', '/api/memory/entries', {
    id,
    title: 'smoke',
    body: 'smoke test memory body',
    tags: ['smoke'],
  });
  rows.push(['create', create.status === 201]);

  const retrieve = await req('POST', '/api/memory/retrieve', { query: 'smoke' });
  rows.push([
    'retrieve',
    retrieve.status === 200 && String(retrieve.json.block).includes('smoke'),
  ]);

  const del = await req('DELETE', `/api/memory/entries/${id}`);
  rows.push(['delete', del.status === 200 && del.json.ok === true]);

  let pass = true;
  for (const [name, ok] of rows) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) pass = false;
  }
  process.exit(pass ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
