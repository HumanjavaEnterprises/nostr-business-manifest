/**
 * Builder parity gate — the TypeScript port of the builder/validator must produce
 * output BYTE-IDENTICAL to the original JavaScript implementation.
 *
 * The original source is preserved unchanged under `test/legacy/` and imported here
 * as the oracle. For every fixture we build the manifest both ways and assert:
 *   1. deep structural equality (`toEqual`), and
 *   2. byte equality of `JSON.stringify(...)` — which also pins property ORDER,
 *      the thing a deep-equal alone would miss.
 * Existing consumers depend on this output not drifting.
 */
import { describe, it, expect } from 'vitest';

// The TypeScript port under test.
import {
  buildBusinessManifest,
  linksToChannels,
  validateBusinessManifest,
  BPUB_BUSINESS,
  VERSION,
  LICENSE,
  ATTRIBUTION_NOTICE,
  CHANNEL_VIA,
} from '../src/index.js';

// The original JavaScript, preserved verbatim — the parity oracle.
// @ts-expect-error — plain JS module, no types.
import * as legacy from './legacy/index.js';

// Every fixture passes `generated_by`, an explicit `page`, and an explicit `registry`
// — mirroring how a real adopting platform calls the builder. The builder's DEFAULTS
// (generated_by; the slug→page derivation, now gated on a caller-supplied `hostBase`;
// the omitted registry) changed in this release, so those defaults are deliberately
// kept OUT of the byte-for-byte legacy comparison and are pinned by dedicated tests
// below. Every domain is an obviously-fictional example.* host — never a live product.
/** A representative fixture set spanning every builder branch. */
const FIXTURES: Record<string, any> = {
  'links-style (directory shape)': {
    slug: 'joes',
    biz_id: 'biz_abc',
    name: 'Joe’s Plumbing',
    tagline: 'Fast & fair',
    description: 'Plumbing.',
    category: 'plumber',
    geo: 'toronto',
    verified: true,
    lang: 'en',
    languages: ['en', 'fr'],
    updated: '2026-06-21',
    generated_by: 'directory',
    page: 'https://joes.directory.example.com',
    registry: 'https://directory.example.com',
    npub: 'npub1xyz',
    links: [
      { kind: 'website', url: 'https://joes.example.com' },
      { kind: 'booking', url: 'https://book.joes.example.com' },
      { kind: 'pay', url: 'https://pay.joes.example.com' },
      { kind: 'social', url: 'https://social.example.com/joes' },
      { kind: 'other', url: 'mailto:hi@joes.example.com' },
    ],
  },
  'explicit-channels (KV shape) + branding icon': {
    name: 'Sunny Tanning',
    page: 'https://sunny.example.com',
    registry: 'https://registry.example.com',
    verified: true,
    generated_by: 'test-emitter',
    channels: {
      book: { via: 'voice', endpoint: '+12505550123' },
      pay: { via: 'email', endpoint: 'payments@sunny.example.com' },
      support: { via: 'email', endpoint: 'support@sunny.example.com' },
    },
    icon: { style: 'icons', seed: 'sun', icon: ['sun'], backgroundColor: ['10b981'] },
  },
  'hours carried through': {
    name: 'X',
    page: 'https://x.example.com',
    registry: 'https://registry.example.com',
    generated_by: 'test-emitter',
    hours: [{ day: 'mon', open: '09:00', close: '17:00', tz: 'America/Vancouver' }],
  },
  'interac flagship (spec example)': {
    name: 'Sunny Tanning',
    page: 'https://sunny.example.com',
    registry: 'https://registry.example.com',
    generated_by: 'test-emitter',
    channels: {
      book: { via: 'voice', endpoint: '+12505550123' },
      pay: { via: 'interac', endpoint: 'payments@sunny.example.com', note: 'e-transfer; holding place only' },
      support: { via: 'email', endpoint: 'support@sunny.example.com' },
      ask: { via: 'mcp', endpoint: 'https://sunny.example.com/mcp' },
    },
  },
  'name-only': {
    name: 'Solo Co',
    generated_by: 'test-emitter',
    registry: 'https://registry.example.com',
  },
  'nip05 only (nostr block present, npub null)': {
    name: 'Y',
    nip05: 'y@example.com',
    page: 'https://y.example.com',
    registry: 'https://registry.example.com',
    generated_by: 'test-emitter',
  },
  'logo + colors branding, explicit registry': {
    name: 'Brandy',
    slug: 'brandy',
    page: 'https://brandy.example.com',
    generated_by: 'test-emitter',
    logo: 'https://cdn.example.com/logo.png',
    colors: { primary: '#000', accent: '#fff' },
    registry: 'https://custom.registry.example.com',
  },
  'optional extras (menu/order/quote) present': {
    name: 'Diner',
    page: 'https://diner.example.com',
    registry: 'https://registry.example.com',
    generated_by: 'test-emitter',
    channels: {
      menu: { via: 'web', endpoint: 'https://diner.example.com/menu' },
      order: { via: 'web', endpoint: 'https://diner.example.com/order' },
      quote: { via: 'web', endpoint: 'https://diner.example.com/quote' },
    },
  },
  'explicit website + social passthrough': {
    name: 'Z',
    slug: 'zed',
    page: 'https://zed.example.com',
    registry: 'https://registry.example.com',
    generated_by: 'test-emitter',
    website: 'https://zed.example.com',
    social: 'https://social.example.com/zed',
  },
};

describe('builder parity — TS port === legacy JS (byte-identical)', () => {
  for (const [label, input] of Object.entries(FIXTURES)) {
    it(`buildBusinessManifest: ${label}`, () => {
      const ours = buildBusinessManifest(input);
      const theirs = legacy.buildBusinessManifest(input);
      expect(ours).toEqual(theirs);
      expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
    });
  }

  it('emits the attribution + license notice in meta', () => {
    const m = buildBusinessManifest({ name: 'X', page: 'https://x.example.com' });
    expect(m.meta).toHaveProperty('attribution');
    expect(m.meta.attribution).toBe(ATTRIBUTION_NOTICE);
    expect(m.meta.license).toBe(LICENSE);
  });

  it('default generated_by is "nostr-business-manifest" (intentional change from "info-json")', () => {
    // The new default. Emitters always pass generated_by explicitly, so this change
    // does not affect them — hence the parity fixtures above all set it explicitly.
    expect(buildBusinessManifest({}).meta.generated_by).toBe('nostr-business-manifest');
    expect(buildBusinessManifest({ name: 'X' }).meta.generated_by).toBe('nostr-business-manifest');
    // The preserved legacy oracle still shows the old default — documenting the change.
    expect(legacy.buildBusinessManifest({}).meta.generated_by).toBe('info-json');
    // With page + registry + generated_by supplied explicitly (as adopters do), the two
    // implementations are byte-for-byte identical — the mapping logic did not drift.
    const explicit = {
      name: 'X',
      page: 'https://x.example.com',
      registry: 'https://registry.example.com',
      generated_by: 'some-emitter',
    };
    expect(JSON.stringify(buildBusinessManifest(explicit))).toBe(
      JSON.stringify(legacy.buildBusinessManifest(explicit)),
    );
  });

  it('host-agnostic: DEFAULT output fabricates NO domain and contains no hardcoded product host', () => {
    // A slug is given but no `page` and no `hostBase` → the library must NOT invent a
    // domain, and must never emit the old hardcoded product registry.
    const m = buildBusinessManifest({ slug: 'joes', name: 'Joe’s Plumbing' });
    expect(m.identity.page).toBeNull();
    expect(m.resilience.canonical).toBeNull();
    expect(m.resilience).not.toHaveProperty('registry'); // omitted, not defaulted
    const bytes = JSON.stringify(m);
    expect(bytes).not.toContain('bpub.app'); // no live product domain
    expect(bytes).not.toContain('joes.'); // no fabricated slug subdomain
    // The legacy oracle, by contrast, still hardcodes the product host (documents the change).
    expect(JSON.stringify(legacy.buildBusinessManifest({ slug: 'joes', name: 'Joe’s Plumbing' }))).toContain(
      'bpub.app',
    );
  });

  it('hostBase (caller-supplied) drives the slug→page derivation and the registry default', () => {
    const m = buildBusinessManifest({ slug: 'acme', name: 'Acme', hostBase: 'acme.example' });
    expect(m.identity.page).toBe('https://acme.acme.example');
    expect(m.resilience.canonical).toBe('https://acme.acme.example');
    expect(m.resilience.registry).toBe('https://acme.example'); // seeded from hostBase
    expect(m.resilience.triangulation.page).toBe('https://acme.acme.example');
    // An explicit registry still wins over the hostBase-derived one.
    const m2 = buildBusinessManifest({
      slug: 'acme',
      name: 'Acme',
      hostBase: 'acme.example',
      registry: 'https://registry.example.com',
    });
    expect(m2.resilience.registry).toBe('https://registry.example.com');
  });

  const LINK_FIXTURES: Record<string, { links: any[]; pageUrl?: string }> = {
    'email pay → interac (bare)': { links: [{ kind: 'pay', url: 'mailto:payments@x.ca' }], pageUrl: 'https://x' },
    'url pay stays web': { links: [{ kind: 'pay', url: 'https://pay.x' }] },
    'menu + support(email) + ask backfill': {
      links: [{ kind: 'menu', url: 'https://m' }, { kind: 'support', url: 'help@x.ca' }],
      pageUrl: 'https://x',
    },
    'unknown kinds ignored': { links: [{ kind: 'carrier', url: 'x' }, { kind: 'social', url: 'https://s' }] },
    'empty links, no page': { links: [] },
  };

  for (const [label, { links, pageUrl }] of Object.entries(LINK_FIXTURES)) {
    it(`linksToChannels: ${label}`, () => {
      const ours = linksToChannels(links, { pageUrl });
      const theirs = legacy.linksToChannels(links, { pageUrl });
      expect(ours).toEqual(theirs);
      expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs));
    });
  }

  it('validateBusinessManifest matches legacy across valid + invalid inputs', () => {
    const good = buildBusinessManifest(FIXTURES['links-style (directory shape)']);
    expect(validateBusinessManifest(good)).toEqual(legacy.validateBusinessManifest(good));

    // 0.2.0 adds 'onchain' to the allowed `via` list, so the "must be one of" message
    // gains `|onchain`; otherwise the results are identical.
    const legacyWithOnchain = (m: unknown) => {
      const r = legacy.validateBusinessManifest(m);
      return { ...r, errors: r.errors.map((e: string) => e.replace(/\|interac$/, '|interac|onchain')) };
    };

    const bad = { schema: 'wrong', llm_friendly: false, channels: { book: { via: 'pigeon', endpoint: 'x' } } };
    expect(validateBusinessManifest(bad)).toEqual(legacyWithOnchain(bad));

    const badVia = { ...good, channels: { book: { via: 'pigeon', endpoint: 'x' } } };
    expect(validateBusinessManifest(badVia)).toEqual(legacyWithOnchain(badVia));

    const onchainPay = { ...good, channels: { pay: { via: 'onchain', endpoint: 'bc1qexampleaddr' } } };
    expect(validateBusinessManifest(onchainPay).valid).toBe(true);
  });

  it('exported constants match legacy', () => {
    expect(BPUB_BUSINESS).toBe(legacy.BPUB_BUSINESS);
    expect(VERSION).toBe(legacy.VERSION);
    expect(LICENSE).toBe(legacy.LICENSE);
    expect(ATTRIBUTION_NOTICE).toBe(legacy.ATTRIBUTION_NOTICE);
    // 0.2.0 adds 'onchain' (what bindEntity has always emitted for a pay address) — an
    // intentional extension; the builder itself never emits it, so builder parity holds.
    expect(CHANNEL_VIA).toEqual([...legacy.CHANNEL_VIA, 'onchain']);
  });
});
