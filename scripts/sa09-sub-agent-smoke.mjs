
const base = process.argv[2] ?? 'http://localhost:5173';

async function main() {
  const ping = await fetch(`${base}/api/config/ping`);
  if (!ping.ok) {
    console.error('Config API not available. Run npm start.');
    process.exit(1);
  }

  const subAgents = await fetch(`${base}/api/config/sub-agents`);
  if (!subAgents.ok) {
    console.error('GET /api/config/sub-agents failed', subAgents.status);
    process.exit(1);
  }

  const body = await subAgents.json();
  if (body.enabled === false) {
    console.error('Sub-agents disabled in config');
    process.exit(1);
  }

  console.log('Sub-agents config OK:', Object.keys(body.types ?? {}).join(', '));
  console.log(
    'Full spawn smoke requires browser/LM Studio; run unit tests: npx tsx --test test/sub-agents/**/*.test.mts',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
