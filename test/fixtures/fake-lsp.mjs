/**
 * Minimal stdio LSP server for tests — static diagnostics on .fake files.
 */

import process from 'node:process';

let buffer = '';

function send(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

function handleMessage(msg) {
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          completionProvider: { triggerCharacters: ['.'] },
        },
      },
    });
    return;
  }

  if (msg.method === 'initialized') {
    return;
  }

  if (msg.method === 'textDocument/completion') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const items =
      uri.includes('sample.fake') || uri.endsWith('.fake')
        ? [
            {
              label: 'fakeKeyword',
              kind: 14,
              detail: 'Fake LSP keyword',
              insertText: 'fakeKeyword',
            },
            {
              label: 'console.log',
              kind: 3,
              detail: 'Log to console',
              insertText: 'console.log($0)',
            },
          ]
        : [];
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { isIncomplete: false, items },
    });
    return;
  }

  if (msg.method === 'textDocument/didOpen') {
    const uri = msg.params?.textDocument?.uri ?? '';
    if (uri.includes('sample.fake')) {
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
              severity: 1,
              message: "';' expected.",
              source: 'fake',
            },
          ],
        },
      });
    }
    return;
  }

  if (msg.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
    return;
  }

  if (msg.method === 'exit') {
    process.exit(0);
  }

  if (msg.id != null && msg.method == null) {
    return;
  }

  if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;
    const len = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.slice(bodyStart, bodyStart + len);
    buffer = buffer.slice(bodyStart + len);
    try {
      handleMessage(JSON.parse(body));
    } catch {
      /* ignore parse errors in fake server */
    }
  }
});
