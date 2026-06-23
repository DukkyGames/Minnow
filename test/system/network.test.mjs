/**
 * LAN address discovery helpers.
 */

import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { listLanAddresses, buildNetworkUrls } from '../../server/system/network.js';

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
      assert.deepEqual(addrs, ['10.0.0.5', '192.168.1.42']);
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
