/**
 * Packaging gates (review 2026-11-10, X1/X2/B4): every bundler/edge condition must
 * resolve to the ESM build (which has real named exports), never the IIFE script, and
 * the license field points at the LICENSE file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('package.json exports', () => {
  it('browser / workerd / worker conditions point at the ESM build', () => {
    const root = pkg.exports['.'];
    for (const cond of ['browser', 'workerd', 'worker', 'import']) {
      expect(root[cond], cond).toBe('./dist/index.js');
    }
  });

  it('no top-level "browser" field that would redirect bundlers to the IIFE', () => {
    expect(pkg.browser === undefined || pkg.browser === './dist/index.js').toBe(true);
  });

  it('the IIFE is only offered as a <script> asset (unpkg / jsdelivr)', () => {
    expect(pkg.unpkg).toBe('./dist/browser/nostr-business-manifest.min.js');
    expect(pkg.jsdelivr).toBe('./dist/browser/nostr-business-manifest.min.js');
  });
});

describe('package.json license', () => {
  it('points at the LICENSE file (custom terms, no SPDX id)', () => {
    expect(pkg.license).toBe('SEE LICENSE IN LICENSE');
  });
});

describe('package.json hygiene', () => {
  it('declares engines, sideEffects and ships no source maps', () => {
    expect(pkg.engines?.node).toBe('>=20');
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.files).toContain('!dist/**/*.map');
  });
});
