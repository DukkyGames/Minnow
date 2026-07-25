import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  findFreePort,
  parseLsofListening,
  parseNetstatListening,
  parseTasklistCsv,
} from '../../server/dev-server/ports.js';
import { assessPortOwnerKill, isProtectedPortOwner } from '../../server/tools/host-kill-guard.js';

describe('dev-server ports', () => {
  test('parseNetstatListening extracts LISTENING rows', () => {
    const sample = `
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       14022
  TCP    127.0.0.1:9473         0.0.0.0:0              LISTENING       6100
  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     14022
`;
    const rows = parseNetstatListening(sample);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].port, 5173);
    assert.equal(rows[0].pid, 14022);
    assert.equal(rows[1].port, 9473);
  });

  test('parseLsofListening extracts listen rows', () => {
    const sample = `
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    14022 me   23u  IPv4  1u     0t0  TCP *:5173 (LISTEN)
electron 6100 me   40u  IPv4  2u     0t0  TCP 127.0.0.1:9473 (LISTEN)
`;
    const rows = parseLsofListening(sample);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].process, 'node');
    assert.equal(rows[0].port, 5173);
  });

  test('parseTasklistCsv maps pid to image', () => {
    const map = parseTasklistCsv('"node.exe","14022","Console","1","12,000 K"\n');
    assert.equal(map.get(14022), 'node.exe');
  });

  test('findFreePort skips used ports', () => {
    assert.equal(findFreePort(3000, [3000, 3001]), 3002);
  });

  test('assessPortOwnerKill refuses process.pid', () => {
    const msg = assessPortOwnerKill(process.pid, 12345);
    assert.ok(msg);
    assert.match(msg, /refusing/i);
    assert.equal(isProtectedPortOwner(process.pid, 12345), true);
  });
});
