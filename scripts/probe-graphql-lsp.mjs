import { spawn } from 'node:child_process';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLspSpawnArgv } from '../server/lsp/resolve-command.js';

const token = '$minnow:graphql-lsp';
const relPath = 'test/fixtures/lsp-manual-probe/test_lsp.graphql';
const langId = 'graphql';

const { argv } = resolveLspSpawnArgv([token]);
const root = path.resolve('.');
const fileUri = pathToFileURL(path.join(root, relPath)).href;
const fs = await import('node:fs/promises');
const text = await fs.readFile(relPath, 'utf8');
const child = spawn(argv[0], argv.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write('stderr: ' + d));
child.on('exit', (code, sig) => console.log('child exit', code, sig));
const conn = createMessageConnection(
  new StreamMessageReader(child.stdout),
  new StreamMessageWriter(child.stdin),
);
conn.onRequest('workspace/configuration', (params) => {
  console.log('workspace/configuration', JSON.stringify(params));
  return params.items.map(() => ({}));
});
conn.onRequest('client/registerCapability', () => null);
conn.onNotification('textDocument/publishDiagnostics', (p) => {
  console.log('diags', p.diagnostics?.length);
});
conn.onNotification(/.*/, (m) => console.log('notif', m?.method));
conn.listen();
try {
  const init = await conn.sendRequest('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    capabilities: {
      workspace: { configuration: true },
      textDocument: { publishDiagnostics: {} },
    },
  });
  console.log('init ok', Object.keys(init?.capabilities ?? {}));
  conn.sendNotification('initialized', {});
  await new Promise((r) => setTimeout(r, 1000));
  conn.sendNotification('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: langId, version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 5000));
} catch (e) {
  console.error('error', e);
}
child.kill();
