import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as dbRoot from '../index.js';

// The '@studio/db/server' subpath is the service tier: the RLS-bypassing
// client factory plus the env loader that reads the service key. The web
// app must never import it — the root '@studio/db' export structurally
// cannot construct a service client, so the only way to break that
// boundary is a literal subpath import, which this credential-free test
// fails the build on. (If apps/web moves or disappears, readdirSync
// throws — the guard cannot silently pass on repo-layout drift.)

const WEB_APP = fileURLToPath(new URL('../../../../apps/web', import.meta.url));
const DB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The same service tier, reached by other spellings:
//   * '@studio/db/src/server'  — a deep import past the exports map
//   * 'packages/db/src/server' — a relative hop out of the app directory
// The exports map in packages/db/package.json blocks the deep import at
// build time; the relative hop is blocked by nothing except this test.
const SERVICE_SUBPATH_PATTERNS = [
  '@studio/db/server',
  '@studio/db/src/server',
  'packages/db/src/server',
];

// The web tier may import the root package and nothing else.
const DB_PACKAGE = '@studio/db';

// Everything the web app can execute. '.js'/'.jsx'/'.mjs' count because a
// stray CommonJS file would reach the same module graph as a .ts one.
const SOURCE_EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs)$/;

// Build output and deps are not source — they are generated, huge, and
// legitimately contain third-party code.
const IGNORED_DIRS = new Set(['node_modules', '.next', 'out', 'dist', 'build', 'coverage']);

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (SOURCE_EXTENSIONS.test(entry)) yield full;
  }
}

/**
 * Removes comments while KEEPING string literals.
 *
 * Comments are stripped so the web tier may explain the rule (a comment
 * naming the forbidden path is documentation, not a violation). String
 * literals are kept because that is exactly where a violating import
 * lives — including dynamic `import('...')` and `require('...')` forms.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'string' = 'code';
  let quote = '';

  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];

    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = 'string';
        quote = char;
        out += char;
        i += 1;
        continue;
      }
      out += char;
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      if (char === '\n') out += char;
      i += 1;
      continue;
    }

    // string state — copy the literal through, honouring escapes so a
    // quote inside a string does not end it early.
    if (char === '\\') {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    out += char;
    if (char === quote) state = 'code';
    i += 1;
  }

  return out;
}

/**
 * Collapses the ways one specifier can be spelled apart.
 *
 * A plain substring check misses `'@studio/db/' + 'server'` and
 * `` `@studio/db/${'server'}` `` — the same import, written so the
 * forbidden path never appears contiguously. Stripping quotes,
 * concatenation, interpolation markers, and whitespace makes those
 * spellings collapse back onto the string the literal check looks for.
 *
 * The interpolation's CONTENT is kept, not deleted: in
 * `` `${'server'}` `` the word "server" is the payload.
 */
export function squashSpecifier(code: string): string {
  return code
    .replace(/\$\{|\}/g, '') // interpolation markers (content kept)
    .replace(/['"`]/g, '') // quote characters
    .replace(/\+/g, '') // string concatenation
    .replace(/\s+/g, ''); // whitespace
}

/**
 * True when '@studio/db' is referenced as a SUBPATH.
 *
 * The web tier may import the root '@studio/db' and nothing else. A
 * reference followed by '/' or '.' is a subpath — including one whose
 * tail is an interpolation (`@studio/db/${x}`), which no static scan
 * can resolve and which is therefore a violation on its own.
 */
export function referencesDbSubpath(code: string): boolean {
  let index = code.indexOf(DB_PACKAGE);
  while (index !== -1) {
    const next = code[index + DB_PACKAGE.length];
    if (next === '/' || next === '.') return true;
    index = code.indexOf(DB_PACKAGE, index + DB_PACKAGE.length);
  }
  return false;
}

/** True when the source references the service subpath in executable code. */
export function referencesServiceSubpath(source: string): boolean {
  const code = stripComments(source);
  if (SERVICE_SUBPATH_PATTERNS.some((pattern) => code.includes(pattern))) return true;
  if (referencesDbSubpath(code)) return true;
  const squashed = squashSpecifier(code);
  return SERVICE_SUBPATH_PATTERNS.some((pattern) => squashed.includes(pattern));
}

describe('service-tier subpath guard', () => {
  it('apps/web never imports the service subpath', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(WEB_APP)) {
      if (referencesServiceSubpath(readFileSync(file, 'utf8'))) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the root @studio/db export cannot reach the service tier', () => {
    // The structural half of the boundary: even a web tier that imported
    // '@studio/db' (the safe root) must not be able to construct a service
    // client. Asserted against the RUNTIME module namespace, not the
    // source text — a wildcard `export *` that dragged a service symbol
    // in would pass a regex scan but fail here.
    for (const symbol of [
      'createServiceClient',
      'loadDbConfig',
      'integrationTestEnvAvailable',
      'DbConfigurationError',
    ]) {
      expect(Object.hasOwn(dbRoot, symbol)).toBe(false);
    }
  });

  it('the exports map exposes only the safe root and the service subpath', () => {
    // A new subpath export would be a new way into the service tier.
    const pkg = JSON.parse(readFileSync(join(DB_ROOT, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(pkg.exports ?? {}).sort()).toEqual(['.', './server']);
  });
});

describe('stripComments', () => {
  it('ignores a comment that only names the forbidden path', () => {
    const source = [
      '// never import @studio/db/server from the web tier',
      '/* @studio/db/server lives behind the service subpath */',
      'export const ok = 1;',
    ].join('\n');
    expect(referencesServiceSubpath(source)).toBe(false);
  });

  it('still catches static, dynamic, and require forms', () => {
    expect(referencesServiceSubpath("import { createServiceClient } from '@studio/db/server';")).toBe(
      true,
    );
    expect(referencesServiceSubpath("const m = await import('@studio/db/server');")).toBe(true);
    expect(referencesServiceSubpath("const m = require('@studio/db/server');")).toBe(true);
    expect(referencesServiceSubpath("import { listProjects } from '@studio/db';")).toBe(false);
  });

  it('catches the deep and relative spellings of the service tier', () => {
    // The exports map blocks '@studio/db/src/server' at build time, but the
    // guard must not depend on the resolver to catch it.
    expect(referencesServiceSubpath("import { createServiceClient } from '@studio/db/src/server';")).toBe(
      true,
    );
    expect(
      referencesServiceSubpath("import { createServiceClient } from '../../packages/db/src/server.js';"),
    ).toBe(true);
    expect(
      referencesServiceSubpath("const m = await import('packages/db/src/server');"),
    ).toBe(true);
  });

  it('catches a specifier split across concatenation or interpolation', () => {
    // These are the same import written so the forbidden path never
    // appears contiguously in the source.
    expect(referencesServiceSubpath("import { createServiceClient } from '@studio/db/' + 'server';")).toBe(
      true,
    );
    expect(referencesServiceSubpath("const m = require('@studio/db' + '/server');")).toBe(true);
    expect(referencesServiceSubpath("const m = await import(`@studio/db/${'server'}`);")).toBe(true);
    expect(referencesServiceSubpath('const m = await import(`@studio/db/${x}`);')).toBe(true);
  });

  it('does not flag a safe root import split the same way', () => {
    expect(referencesServiceSubpath("import { listProjects } from '@studio/db';")).toBe(false);
    expect(referencesServiceSubpath("const m = await import('@studio/db');")).toBe(false);
  });

  it('does not mistake a URL for a comment', () => {
    const source = "const url = 'https://example.com//path'; import x from '@studio/db/server';";
    expect(referencesServiceSubpath(source)).toBe(true);
  });
});
