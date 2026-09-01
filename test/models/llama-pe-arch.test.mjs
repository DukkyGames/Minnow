/**
 * Windows PE machine-type guard for managed llama-server.exe.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import {
  assertLlamaServerMatchesHostArch,
  llamaServerPeArchMismatch,
  readWindowsPeMachine,
} from '../../server/models/llama-runtime.js';

const PE_MACHINE_AMD64 = 0x8664;
const PE_MACHINE_ARM64 = 0xaa64;

const tmpFiles = [];

function writeFakePe(machine) {
  const peOff = 64;
  const buf = Buffer.alloc(peOff + 6);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(peOff, 60);
  buf.write('PE\0\0', peOff, 'ascii');
  buf.writeUInt16LE(machine, peOff + 4);
  const filePath = path.join(os.tmpdir(), `minnow-pe-${machine.toString(16)}-${Date.now()}.exe`);
  fs.writeFileSync(filePath, buf);
  tmpFiles.push(filePath);
  return filePath;
}

after(() => {
  for (const filePath of tmpFiles) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* tmp cleanup */
    }
  }
});

describe('llama-server PE arch', () => {
  test('non-PE files are not a mismatch (test stubs)', () => {
    const stub = path.join(os.tmpdir(), `minnow-pe-stub-${Date.now()}.exe`);
    fs.writeFileSync(stub, 'fake-llama-server');
    tmpFiles.push(stub);
    assert.equal(readWindowsPeMachine(stub), null);
    assert.equal(llamaServerPeArchMismatch(stub), false);
    assert.doesNotThrow(() => assertLlamaServerMatchesHostArch(stub));
  });

  test('refuses a PE for the other Windows CPU', () => {
    if (process.platform !== 'win32') return;
    const foreign = process.arch === 'arm64' ? PE_MACHINE_AMD64 : PE_MACHINE_ARM64;
    const native = process.arch === 'arm64' ? PE_MACHINE_ARM64 : PE_MACHINE_AMD64;
    const wrong = writeFakePe(foreign);
    const right = writeFakePe(native);
    assert.equal(readWindowsPeMachine(wrong), foreign);
    assert.equal(llamaServerPeArchMismatch(wrong), true);
    assert.throws(() => assertLlamaServerMatchesHostArch(wrong), /different CPU|host is/i);
    assert.equal(llamaServerPeArchMismatch(right), false);
    assert.doesNotThrow(() => assertLlamaServerMatchesHostArch(right));
  });
});
