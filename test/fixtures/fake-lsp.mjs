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
  return uri.includes('.fake');
}

function fakeFileBaseName(uri) {
  try {
    const decoded = decodeURIComponent(uri.split('/').pop() ?? '');
    return decoded;
  } catch {
    return uri.split('/').pop() ?? '';
  }
}

function publishDiagnostics(uri, diagnostics) {
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics },
  });
}

/** Diagnostic publication modes for agent-scope integration tests. */
function publishDiagnosticsForFixture(uri) {
  const base = fakeFileBaseName(uri);

  if (base === 'delayed-empty-then-error.fake') {
    publishDiagnostics(uri, []);
    setTimeout(() => {
      publishDiagnostics(uri, [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          severity: 1,
          message: 'Delayed semantic error.',
          source: 'fake',
        },
      ]);
    }, 350);
    return;
  }

  if (base === 'confirmed-clean.fake') {
    setTimeout(() => {
      publishDiagnostics(uri, []);
    }, 100);
    return;
  }

  if (base === 'never-publishes.fake') {
    return;
  }

  if (base === 'sample.fake' || uri.includes('sample.fake')) {
    publishDiagnostics(uri, [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        message: "';' expected.",
        source: 'fake',
      },
    ]);
  }
}

function fakeCallHierarchyItem(uri, name, line = 0) {
  return {
    name,
    kind: 12,
    uri,
    range: {
      start: { line, character: 0 },
      end: { line, character: name.length },
    },
    selectionRange: {
      start: { line, character: 0 },
      end: { line, character: name.length },
    },
    data: { fixture: name },
  };
}

function fakeDocumentSymbols(uri) {
  return [
    {
      name: 'MY_EXPORT',
      kind: 14,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 24 },
      },
      selectionRange: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 22 },
      },
      children: [
        {
          name: 'callee',
          kind: 12,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 20 },
          },
          selectionRange: {
            start: { line: 0, character: 16 },
            end: { line: 0, character: 22 },
          },
        },
      ],
    },
    {
      name: 'caller',
      kind: 12,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 3, character: 1 },
      },
      selectionRange: {
        start: { line: 1, character: 16 },
        end: { line: 1, character: 22 },
      },
    },
  ];
}

function fakeWorkspaceSymbols(uri, query) {
  const q = String(query ?? '').toLowerCase();
  const all = [
    {
      name: 'MY_EXPORT',
      kind: 14,
      location: {
        uri,
        range: {
          start: { line: 0, character: 13 },
          end: { line: 0, character: 22 },
        },
      },
      containerName: 'sample.fake',
    },
    {
      name: 'callee',
      kind: 12,
      location: {
        uri,
        range: {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 22 },
        },
      },
    },
    {
      name: 'caller',
      kind: 12,
      location: {
        uri,
        range: {
          start: { line: 1, character: 16 },
          end: { line: 1, character: 22 },
        },
      },
    },
  ];
  if (!q) return all;
  return all.filter((sym) => sym.name.toLowerCase().includes(q));
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
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          callHierarchyProvider: true,
          documentFormattingProvider: true,
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
    const lspContext = msg.params?.context;
    const baseItems =
      isFakeUri(uri)
        ? [
            {
              label: 'rankedFirst',
              kind: 14,
              sortText: '0000',
              filterText: 'rankedFirst',
              preselect: true,
              commitCharacters: [';', '.'],
              insertText: 'rankedFirst',
            },
            {
              label: 'rankedSecond',
              kind: 14,
              sortText: '9999',
              filterText: 'rankedSecondFilter',
              insertText: 'rankedSecond',
            },
            {
              label: 'overload',
              kind: 3,
              detail: '(): void',
              insertText: 'overload()',
            },
            {
              label: 'overload',
              kind: 3,
              detail: '(x: number): void',
              insertText: 'overload(x)',
            },
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

    const items = [...baseItems];
    if (
      isFakeUri(uri) &&
      lspContext?.triggerKind === 2 &&
      lspContext?.triggerCharacter === '.'
    ) {
      items.unshift({
        label: 'triggerDot',
        kind: 14,
        detail: `triggerKind=${lspContext.triggerKind}`,
        insertText: 'triggerDot',
      });
    }
    if (isFakeUri(uri) && lspContext?.triggerKind === 3) {
      items.unshift({
        label: 'incompleteRefetch',
        kind: 14,
        insertText: 'incompleteRefetch',
      });
    }

    const isIncomplete = isFakeUri(uri) && lspContext?.triggerKind === 3;
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { isIncomplete, items },
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

  if (msg.method === 'textDocument/formatting') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const result = isFakeUri(uri)
      ? [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'formatted',
          },
        ]
      : [];
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/documentSymbol') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const result = isFakeUri(uri) ? fakeDocumentSymbols(uri) : [];
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'workspace/symbol') {
    const query = msg.params?.query ?? '';
    const uri = 'file:///fake-workspace/test/fixtures/sample.fake';
    const result = fakeWorkspaceSymbols(uri, query);
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/prepareCallHierarchy') {
    const uri = msg.params?.textDocument?.uri ?? '';
    const pos = msg.params?.position ?? { line: 0, character: 0 };
    const result = isFakeUri(uri)
      ? [fakeCallHierarchyItem(uri, pos.line === 1 ? 'caller' : 'callee', pos.line)]
      : null;
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'callHierarchy/incomingCalls') {
    const item = msg.params?.item ?? {};
    const uri = item.uri ?? '';
    const result =
      isFakeUri(uri) && item.name === 'callee'
        ? [
            {
              from: fakeCallHierarchyItem(uri, 'caller', 1),
              fromRanges: [
                {
                  start: { line: 2, character: 2 },
                  end: { line: 2, character: 8 },
                },
              ],
            },
          ]
        : [];
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'callHierarchy/outgoingCalls') {
    const item = msg.params?.item ?? {};
    const uri = item.uri ?? '';
    const result =
      isFakeUri(uri) && item.name === 'caller'
        ? [
            {
              to: fakeCallHierarchyItem(uri, 'callee', 0),
              fromRanges: [
                {
                  start: { line: 2, character: 2 },
                  end: { line: 2, character: 8 },
                },
              ],
            },
          ]
        : [];
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }

  if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
    const uri = msg.params?.textDocument?.uri ?? '';
    if (isFakeUri(uri)) {
      publishDiagnosticsForFixture(uri);
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
