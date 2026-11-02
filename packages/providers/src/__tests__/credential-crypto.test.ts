import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  loadCredentialEncryptionKey,
  maskSecret,
  secretFingerprint,
} from '../credential-crypto.js';
import { ProviderConfigError } from '../types.js';

const KEY = Buffer.alloc(32, 7); // deterministic 32-byte KEK for tests

describe('loadCredentialEncryptionKey', () => {
  it('accepts a valid base64 32-byte key', () => {
    const env = { CREDENTIAL_ENCRYPTION_KEY: KEY.toString('base64') };
    expect(loadCredentialEncryptionKey(env).length).toBe(32);
  });

  it('throws when missing', () => {
    expect(() => loadCredentialEncryptionKey({})).toThrow(ProviderConfigError);
    expect(() => loadCredentialEncryptionKey({ CREDENTIAL_ENCRYPTION_KEY: '  ' })).toThrow(ProviderConfigError);
  });

  it('throws when the key is the wrong size', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadCredentialEncryptionKey({ CREDENTIAL_ENCRYPTION_KEY: short })).toThrow(ProviderConfigError);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('roundtrips a key', () => {
    const secret = 'nvapi-abcdefghijklmnopqrstuvwxyz0123456789';
    const envelope = encryptSecret(secret, KEY);
    expect(envelope).not.toContain(secret);
    expect(decryptSecret(envelope, KEY)).toBe(secret);
  });

  it('uses a fresh IV every time (same input, different envelopes)', () => {
    const a = encryptSecret('same-key', KEY);
    const b = encryptSecret('same-key', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('same-key');
    expect(decryptSecret(b, KEY)).toBe('same-key');
  });

  it('fails closed on a tampered ciphertext', () => {
    const envelope = encryptSecret('secret', KEY);
    const parts = envelope.split('.');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString('base64url');
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(ProviderConfigError);
  });

  it('fails closed with the wrong KEK', () => {
    const envelope = encryptSecret('secret', KEY);
    const otherKey = Buffer.alloc(32, 9);
    expect(() => decryptSecret(envelope, otherKey)).toThrow(ProviderConfigError);
  });

  it('rejects malformed envelopes', () => {
    expect(() => decryptSecret('not-an-envelope', KEY)).toThrow(ProviderConfigError);
    expect(() => decryptSecret('v2.a.b.c', KEY)).toThrow(ProviderConfigError);
  });
});

describe('maskSecret', () => {
  it('keeps a provider-style prefix and last 4', () => {
    expect(maskSecret('nvapi-abcdef1234567890')).toBe('nvapi-…7890');
  });

  it('falls back to the first 4 chars without a word-prefix', () => {
    expect(maskSecret('1234567890abcdef')).toBe('1234…cdef');
  });

  it('shows only the tail for short keys', () => {
    expect(maskSecret('abcd1234')).toBe('…1234');
  });
});

describe('secretFingerprint', () => {
  it('is deterministic and does not contain the key', () => {
    const fp = secretFingerprint('nvapi-abcdef1234567890');
    expect(fp).toBe(secretFingerprint(' nvapi-abcdef1234567890 '));
    expect(fp).toMatch(/^[0-9a-f]{10}$/);
    expect(fp).not.toContain('abcdef1234567890');
  });
});
