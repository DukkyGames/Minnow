/**
 * Network access policy — resolveNetworkAccess and isClientAllowed.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNetworkAccess,
  resolveConfigNetworkAccess,
  isClientAllowed,
  initNetworkAccess,
  isNetworkRestartRequired,
  resolveViteHost,
} from '../../server/network/access.js';

/** @param {string} address */
function mockReq(address) {
  return { socket: { remoteAddress: address } };
}

describe('resolveNetworkAccess', () => {
  test('defaults to local when config is empty', () => {
    assert.equal(resolveNetworkAccess({}), 'local');
    assert.equal(resolveConfigNetworkAccess({}), 'local');
  });

  test('reads server.networkAccess from config', () => {
    assert.equal(resolveConfigNetworkAccess({ server: { networkAccess: 'lan' } }), 'lan');
    assert.equal(resolveConfigNetworkAccess({ server: { networkAccess: 'local' } }), 'local');
  });

  test('MINNOW_NETWORK env overrides config', () => {
    const prev = process.env.MINNOW_NETWORK;
    process.env.MINNOW_NETWORK = 'lan';
    try {
      assert.equal(resolveNetworkAccess({ server: { networkAccess: 'local' } }), 'lan');
    } finally {
      if (prev === undefined) delete process.env.MINNOW_NETWORK;
      else process.env.MINNOW_NETWORK = prev;
    }
  });

  test('resolveViteHost maps modes to Vite host option', () => {
    assert.equal(resolveViteHost('local'), 'localhost');
    assert.equal(resolveViteHost('lan'), true);
  });
});

describe('isClientAllowed', () => {
  test('allows loopback in local mode', () => {
    initNetworkAccess({});
    assert.equal(isClientAllowed(mockReq('127.0.0.1'), 'local'), true);
    assert.equal(isClientAllowed(mockReq('::1'), 'local'), true);
    assert.equal(isClientAllowed(mockReq('::ffff:127.0.0.1'), 'local'), true);
  });

  test('blocks RFC1918 in local mode', () => {
    assert.equal(isClientAllowed(mockReq('192.168.1.10'), 'local'), false);
    assert.equal(isClientAllowed(mockReq('10.0.0.5'), 'local'), false);
  });

  test('allows RFC1918 in lan mode', () => {
    assert.equal(isClientAllowed(mockReq('192.168.1.10'), 'lan'), true);
    assert.equal(isClientAllowed(mockReq('::ffff:192.168.1.10'), 'lan'), true);
    assert.equal(isClientAllowed(mockReq('10.0.0.5'), 'lan'), true);
  });

  test('blocks public IPs even in lan mode', () => {
    assert.equal(isClientAllowed(mockReq('8.8.8.8'), 'lan'), false);
    assert.equal(isClientAllowed(mockReq('1.2.3.4'), 'lan'), false);
  });
});

describe('restart detection', () => {
  test('restart required when config differs from active bind', () => {
    initNetworkAccess({ server: { networkAccess: 'local' } });
    assert.equal(isNetworkRestartRequired(), false);
  });
});
