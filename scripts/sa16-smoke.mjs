/**
 * SA-16 automated smoke checks (Node). Run while `npm start` is up.
 * Usage: node scripts/sa16-smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:5176';

async function postTool(name, args) {
  const res = await fetch(`${BASE}/api/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  const body = await res.json();
  return { ok: res.ok, body };
}

async function main() {
  const results = {};

  // Ping
  try {
    const ping = await fetch(`${BASE}/api/tools/ping`);
    const json = await ping.json();
    results.ping = ping.ok && json.ok === true;
  } catch {
    results.ping = false;
  }

  // Server tools
  const read = await postTool('read_file', { path: 'package.json' });
  results.read_file =
    read.ok && String(read.body.result ?? '').includes('"name": "minnow"');

  const git = await postTool('git_status', {});
  results.git_status =
    git.ok && String(git.body.result ?? '').includes('git status');

  // Browser tools (dynamic import)
  try {
    const { executeBrowserTool } = await import(
      '../src/tools/browser-executor.ts'
    );
    const dt = await executeBrowserTool('get_datetime', {});
    results.get_datetime =
      typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(dt);
    const calc = await executeBrowserTool('calculate', { expression: '2+2' });
    results.calculate = String(calc).includes('4');
  } catch (err) {
    results.get_datetime = false;
    results.calculate = false;
    console.error('browser tools:', err);
  }

  // Attachment helpers
  try {
    const { buildHistoryUserContent } = await import('../src/chat/build-api-messages.ts');
    const { processFile } = await import('../src/attachments/reader.ts');
    const { setLocalServerAvailable } = await import('../src/tools/config.ts');

    setLocalServerAvailable(true);

    const tsContent = buildHistoryUserContent('hello', [
      {
        id: '1',
        name: 'foo.ts',
        kind: 'text',
        mimeType: 'text/plain',
        size: 10,
        text: 'export const x = 1',
      },
    ]);
    results.ts_file_in_context =
      tsContent.includes('<file name="foo.ts">') &&
      tsContent.includes('export const x = 1');

    const imgContent = buildHistoryUserContent('', [
      {
        id: '2',
        name: 'a.jpg',
        kind: 'image',
        mimeType: 'image/jpeg',
        size: 1,
        dataUrl: 'data:image/jpeg;base64,/9j',
      },
    ]);
    results.image_history_placeholder = imgContent.includes('[image: a.jpg]');

    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'huge.bin');
    const oversize = await processFile(big);
    results.oversize_15mb_blocked =
      oversize.kind === 'error' &&
      String(oversize.error).includes('10MB limit');

    const smallTs = new File(['export {}'], 'sample.ts', {
      type: 'text/plain',
    });
    const textAtt = await processFile(smallTs);
    // FileReader exists only in the browser; Node smoke still validates extension routing.
    results.process_ts_file =
      typeof FileReader !== 'undefined'
        ? textAtt.kind === 'text' && Boolean(textAtt.text)
        : textAtt.kind !== 'error' ||
          !String(textAtt.error).includes('Unsupported file type');
  } catch (err) {
    console.error('attachments:', err);
    results.ts_file_in_context = false;
    results.image_history_placeholder = false;
    results.oversize_15mb_blocked = false;
    results.process_ts_file = false;
  }

  // Server-unavailable path for server tools
  try {
    const { executeTool } = await import('../src/tools/client.ts');
    const { setLocalServerAvailable } = await import('../src/tools/config.ts');
    setLocalServerAvailable(false);
    const msg = await executeTool('read_file', { path: 'package.json' });
    results.server_tools_error_when_down = msg.includes(
      'local tool server is not available',
    );
    setLocalServerAvailable(true);
  } catch {
    results.server_tools_error_when_down = false;
  }

  console.log(JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => !v);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
