/**
 * SSRF guard for research page fetch.
 */
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { afterEach, describe, it, mock } from 'node:test';
import { assertPublicUrl } from '../../src/lib/assert-public-url.mjs';

describe('assertPublicUrl', () => {
  /** @type {ReturnType<typeof mock.method> | undefined} */
  let lookupMock;

  afterEach(() => {
    lookupMock?.mock.restore();
  });

  it('rejects loopback IPv4 literals', async () => {
    await assert.rejects(() => assertPublicUrl('http://127.0.0.1/'), /blocked IP/);
  });

  it('rejects private RFC1918 literals', async () => {
    await assert.rejects(() => assertPublicUrl('http://10.0.0.5/'), /blocked IP/);
    await assert.rejects(() => assertPublicUrl('http://192.168.1.1/'), /blocked IP/);
  });

  it('rejects link-local metadata address', async () => {
    await assert.rejects(() => assertPublicUrl('http://169.254.169.254/'), /blocked IP/);
  });

  it('rejects localhost hostnames', async () => {
    await assert.rejects(() => assertPublicUrl('http://localhost/'), /blocked host/);
  });

  it('allows public hostnames when DNS resolves to a public address', async () => {
    lookupMock = mock.method(dns, 'lookup', async () => [
      { address: '93.184.216.34', family: 4 },
    ]);
    const url = await assertPublicUrl('https://example.com/path');
    assert.equal(url.hostname, 'example.com');
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    lookupMock = mock.method(dns, 'lookup', async () => [
      { address: '10.0.0.8', family: 4 },
    ]);
    await assert.rejects(() => assertPublicUrl('https://internal.example/'), /resolves to blocked/);
  });
});
