/**
 * Minimal stdio LSP server for tests — static diagnostics, hover, completion on .fake files.
 */

import process from 'node:process';

let buffer = '';

function send(msg) {
  const body = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body);
}

function isFakeUri(uri) {
  return uri.includes('sample.fake') || uri.endsWith('.fake');
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
          hoverProvider: true,
          definitionProvider: true,
          signatureHelpProvider: { triggerCharacters: ['(', ','] },
        },
      },
    });
    return;
  }

  if (msg.method === 'initialized') {
    return;
  }

  if (msg.method === 'textDocument/hover') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const result = isFakeUri(uri)
      ? {
          contents: {
            kind: 'markdown',
            value: '**Fake hover** — test fixture LSP',
          },
        }
      : null;
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/definition') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const pos = msg.params?.position ?? { line: 0, character: 0 };
    const result = isFakeUri(uri)
      ? {
          uri,
          range: {
            start: { line: pos.line, character: 0 },
            end: { line: pos.line, character: 1 },
          },
        }
      : null;
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/signatureHelp') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const result = isFakeUri(uri)
      ? {
          signatures: [
            {
              label: 'fakeFn(param)',
              parameters: [{ label: 'param' }],
            },
          ],
          activeSignature: 0,
          activeParameter: 0,
        }
      : null;
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/completion') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const items =
      isFakeUri(uri)
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
              insertTextFormat: 2,
            },
            {
              label: 'importHelper',
              kind: 3,
              detail: 'Needs resolve',
              insertText: 'importHelper',
              data: { id: 'resolve-me' },
            },
            {
              label: 'rangeEdit',
              kind: 14,
              textEdit: {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 3 },
                },
                newText: 'edited',
              },
            },
            {
              label: 'insertReplace',
              kind: 14,
              textEdit: {
                insert: {
                  start: { line: 0, character: 4 },
                  end: { line: 0, character: 4 },
                },
                replace: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 4 },
                },
                newText: 'replaced',
              },
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

  if (msg.method === 'completionItem/resolve') {
    const item = msg.params ?? {};
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        ...item,
        documentation: { kind: 'markdown', value: 'Resolved **import** docs' },
        additionalTextEdits: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: '// resolved-import\n',
          },
        ],
      },
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
