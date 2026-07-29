/**
 * LAN address discovery helpers.
 */

import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  buildNetworkUrls,
  listLanAddresses,
  rankLanAddress,
} from '../../server/system/network.js';

describe('listLanAddresses', () => {
  test('filters internal, loopback, and link-local IPv4', () => {
    const mockInterfaces = mock.method(os, 'networkInterfaces', () => ({
      eth0: [
        { address: '192.168.1.42', family: 'IPv4', internal: false },
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '169.254.10.1', family: 'IPv4', internal: false },
        { address: '10.0.0.5', family: 'IPv4', internal: false },
      ],
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      wlan0: [
        { address: '192.168.1.42', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
    }));

    try {
      const addrs = listLanAddresses();
      assert.deepEqual(addrs, ['192.168.1.42', '10.0.0.5']);
    } finally {
      mockInterfaces.mock.restore();
    }
  });

  test('prefers Wi-Fi RFC1918 over Tailscale CGNAT and virtual adapters', () => {
    const mockInterfaces = mock.method(os, 'networkInterfaces', () => ({
      tailscale0: [{ address: '100.113.176.113', family: 'IPv4', internal: false }],
      vboxnet0: [{ address: '192.168.56.1', family: 'IPv4', internal: false }],
      wlan0: [{ address: '192.168.4.191', family: 'IPv4', internal: false }],
    }));

    try {
      const addrs = listLanAddresses();
      assert.deepEqual(addrs, ['192.168.4.191', '192.168.56.1', '100.113.176.113']);
      assert.equal(rankLanAddress('192.168.4.191') < rankLanAddress('100.113.176.113'), true);
    } finally {
      mockInterfaces.mock.restore();
    }
  });
});

describe('buildNetworkUrls', () => {
  test('builds http URLs for each LAN address', () => {
    const mockInterfaces = mock.method(os, 'networkInterfaces', () => ({
      eth0: [{ address: '192.168.0.10', family: 'IPv4', internal: false }],
    }));

    try {
      assert.deepEqual(buildNetworkUrls(5173), ['http://192.168.0.10:5173/']);
    } finally {
      mockInterfaces.mock.restore();
    }
  });
});
