import { spawn } from 'node:child_process';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLspSpawnArgv } from '../server/lsp/resolve-command.js';

async function probe(token, relPath, langId) {
  const { argv } = resolveLspSpawnArgv([token]);
  const root = path.resolve('.');
  const fileUri = pathToFileURL(path.join(root, relPath)).href;
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(relPath, 'utf8');
  const child = spawn(argv[0], argv.slice(1), { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const stderr = [];
  child.stderr.on('data', (d) => stderr.push(d.toString()));
  const conn = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  conn.onRequest('workspace/configuration', (params) => {
    console.log(token, 'workspace/configuration', JSON.stringify(params).slice(0, 400));
    return params.items.map(() => ({}));
  });
  conn.onRequest('client/registerCapability', () => null);
  conn.onNotification('textDocument/publishDiagnostics', (p) => {
    console.log(token, 'diags', p.diagnostics?.length, JSON.stringify(p.diagnostics?.slice(0, 3)));
  });
  conn.listen();
  await conn.sendRequest('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    capabilities: {
      workspace: { configuration: true },
      textDocument: { publishDiagnostics: {} },
    },
  });
  conn.sendNotification('initialized', {});
  await new Promise((r) => setTimeout(r, 500));
  conn.sendNotification('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: langId, version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 5000));
  child.kill();
  if (stderr.length) console.log(token, 'stderr', stderr.join('').slice(0, 1200));
  console.log(token, 'done\n');
}

await probe(
  '$minnow:vscode-html-language-server',
  'test/fixtures/lsp-manual-probe/test_lsp.html',
  'html',
);
await probe(
  '$minnow:bash-language-server',
  'test/fixtures/lsp-manual-probe/test_lsp.sh',
  'shellscript',
);
// graphql only when passed --graphql
if (process.argv.includes('--graphql')) {
  await probe(
    '$minnow:graphql-lsp',
    'test/fixtures/lsp-manual-probe/test_lsp.graphql',
    'graphql',
  );
}
