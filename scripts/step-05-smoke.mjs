/**
 * Step 05 smoke: sessions API persists modeId per chat.
 * Usage: npx tsx scripts/step-05-smoke.mjs http://localhost:5173
 */

const base = process.argv[2] ?? 'http://localhost:5173';

async function main() {
  const ping = await fetch(`${base}/api/config/ping`);
  if (!ping.ok) {
    console.error('FAIL: config ping', ping.status);
    process.exit(1);
  }

  const getRes = await fetch(`${base}/api/config/sessions`);
  if (!getRes.ok) {
    console.error('FAIL: GET sessions', getRes.status);
    process.exit(1);
  }

  const state = await getRes.json();
  const chatId = state.chats?.[0]?.id;
  if (!chatId) {
    console.error('FAIL: no chats in session state');
    process.exit(1);
  }

  state.chats[0].modeId = 'plan';
  const putRes = await fetch(`${base}/api/config/sessions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!putRes.ok) {
    console.error('FAIL: PUT sessions', putRes.status);
    process.exit(1);
  }

  const reload = await fetch(`${base}/api/config/sessions`);
  const reloaded = await reload.json();
  const modeId = reloaded.chats?.find((c) => c.id === chatId)?.modeId;
  if (modeId !== 'plan') {
    console.error('FAIL: expected modeId plan, got', modeId);
    process.exit(1);
  }

  console.log('PASS: modeId persisted as plan for chat', chatId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
