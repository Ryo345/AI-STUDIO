// Credential encryption at rest — AES-256-GCM envelope for BYOK API keys.
//
// Threat model: the database is readable by more principals than the app
// (Supabase dashboards, backups, support access). A leaked row must not leak
// a usable key, so plaintext never touches storage — only this envelope:
//
//   'v1.<iv>.<tag>.<ct>'   (each part base64url, no padding ambiguity)
//
// The KEK comes from CREDENTIAL_ENCRYPTION_KEY (base64 of 32 random bytes —
// `openssl rand -base64 32`). It lives only in server env (web + worker);
// it is never logged, never sent to the client, and never derived from
// anything user-visible. Losing it makes stored connections unrecoverable —
// users re-enter keys, which is the correct failure direction.
//
// Server-only by convention: the web tier imports this from API routes
// (node runtime), never from a client component, and no NEXT_PUBLIC var
// ever points at the key.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

import { ProviderConfigError } from './types.js';

export const CREDENTIAL_CRYPTO_VERSION = '0.1.0';

export const CREDENTIAL_KEY_ENV = 'CREDENTIAL_ENCRYPTION_KEY';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const ENVELOPE_VERSION = 'v1';

/** Load + validate the base64 KEK from env. Throws ProviderConfigError (boot-fatal) on absence or wrong size. */
export function loadCredentialEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[CREDENTIAL_KEY_ENV]?.trim() ?? '';
  if (!raw) {
    throw new ProviderConfigError(
      `${CREDENTIAL_KEY_ENV} is required for BYOK credential storage (generate one with: openssl rand -base64 32)`,
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new ProviderConfigError(
      `${CREDENTIAL_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes (base64; generate one with: openssl rand -base64 32)`,
    );
  }
  return key;
}

/**
 * Encrypt a provider API key into the storage envelope. Fresh random IV on
 * every call — the same key encrypted twice never yields the same ciphertext.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

/** Decrypt a storage envelope back to the plaintext key. Tampering fails closed (GCM auth). */
export function decryptSecret(envelope: string, key: Buffer): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new ProviderConfigError('credential envelope is malformed (expected v1.<iv>.<tag>.<ct>)');
  }
  const ivPart = parts[1];
  const tagPart = parts[2];
  const ctPart = parts[3];
  if (!ivPart || !tagPart || !ctPart) {
    throw new ProviderConfigError('credential envelope is malformed (expected v1.<iv>.<tag>.<ct>)');
  }
  try {
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ct = Buffer.from(ctPart, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Wrong KEK or tampered ciphertext — indistinguishable by design, and
    // both fail closed.
    throw new ProviderConfigError('credential envelope failed authentication (wrong key or tampered data)');
  }
}

/**
 * Masked display form for the UI, e.g. 'nvapi-…9f2c'. Reveals the prefix the
 * provider itself uses to identify key types (nvapi-, sk-) plus the last 4
 * chars — the standard BYOK hint. Never the middle.
 */
export function maskSecret(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return `…${trimmed.slice(-4)}`;
  const prefixMatch = /^[a-z]+-/i.exec(trimmed);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const head = prefix.length >= 4 ? prefix : trimmed.slice(0, 4);
  return `${head}…${trimmed.slice(-4)}`;
}

/**
 * Deterministic non-reversible fingerprint for "is this the same key I
 * already stored?" UX checks — the first 10 hex chars of SHA-256. NOT an
 * identifier to authenticate by; a display aid only.
 */
export function secretFingerprint(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex').slice(0, 10);
}
