/**
 * Review 2026-11-10 gates:
 *   B1 — verifyManifest must check the event kind, the `d` tag, the manifest schema and
 *        strict lowercase hex, on top of the signature and the npub binding.
 *   B2 — the default `d` tag comes from the full normalised hostname, not the first label.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  buildBusinessManifest,
  bindEntity,
  signManifest,
  verifyManifest,
  manifestDTag,
  legacyManifestDTag,
  npubOf,
  MANIFEST_KIND,
} from '../src/index.js';
import { computeEventId } from '../src/nostr.js';
import { findDuplicateOrProtoKey } from '../src/sign.js';
import type { NostrEvent } from '../src/index.js';

// Keys are generated at runtime — nothing secret lives in the repo.
const sk = schnorr.utils.randomSecretKey();
const pubkey = bytesToHex(schnorr.getPublicKey(sk));
const npub = npubOf(pubkey);

/** Sign an ARBITRARY event (any kind/tags/content) with the runtime key. */
function signRaw(kind: number, tags: string[][], content: string): NostrEvent {
  const created_at = 1_700_000_000;
  const id = computeEventId({ pubkey, created_at, kind, tags, content });
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { id, pubkey, created_at, kind, tags, content, sig };
}

function goodManifest() {
  const base = buildBusinessManifest({ slug: 'joes', name: 'Joe’s Plumbing', hostBase: 'example.com' });
  return bindEntity(base, { npub });
}

describe('B1 — verifyManifest is strict about what it accepts', () => {
  it('accepts a correctly signed manifest event', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    expect(verifyManifest(ev)).toMatchObject({ valid: true, npub });
  });

  it('rejects a kind-1 note whose content is a valid manifest', () => {
    const ev = signRaw(1, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    const res = verifyManifest(ev);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/kind/);
  });

  it('rejects a kind-30078 event whose content is only {identity:{nostr:{npub}}}', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'x']], JSON.stringify({ identity: { nostr: { npub } } }));
    const res = verifyManifest(ev);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/schema/);
  });

  it('rejects a manifest with the wrong schema string', () => {
    const m = { ...goodManifest(), schema: 'bpub-business/9.9' };
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(m));
    expect(verifyManifest(ev).valid).toBe(false);
  });

  it('rejects a missing, duplicated, empty or non-string d tag', () => {
    const content = JSON.stringify(goodManifest());
    for (const tags of [
      [],
      [['t', 'plumber']],
      [['d', 'a'], ['d', 'b']],
      [['d', '']],
      [['d']],
    ] as string[][][]) {
      const res = verifyManifest(signRaw(MANIFEST_KIND, tags, content));
      expect(res.valid, JSON.stringify(tags)).toBe(false);
      expect(res.reason).toMatch(/d tag/);
    }
  });

  it('rejects uppercase hex in id, pubkey or sig (strict lowercase per NIP-01)', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    expect(verifyManifest({ ...ev, sig: ev.sig.toUpperCase() }).valid).toBe(false);
    expect(verifyManifest({ ...ev, id: ev.id.toUpperCase() }).valid).toBe(false);
    expect(verifyManifest({ ...ev, pubkey: ev.pubkey.toUpperCase() }).valid).toBe(false);
  });

  it('rejects non-array tags and non-integer created_at without throwing', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    expect(verifyManifest({ ...ev, tags: 'd' as unknown as string[][] }).valid).toBe(false);
    expect(verifyManifest({ ...ev, created_at: 1.5 }).valid).toBe(false);
    expect(verifyManifest({ ...ev, content: 5 as unknown as string }).valid).toBe(false);
  });

  it('a manifest bound with a pay address (via "onchain") passes the schema and verifies', () => {
    const m = bindEntity(goodManifest(), { npub, payAddress: 'bc1qexampleaddr', payAsset: 'BTC' });
    const ev = signManifest(m, bytesToHex(sk));
    expect(verifyManifest(ev)).toMatchObject({ valid: true, npub });
  });

  it('still binds the claimed npub to the signing pubkey on a schema-valid manifest', () => {
    const other = npubOf(bytesToHex(schnorr.getPublicKey(schnorr.utils.randomSecretKey())));
    const m = bindEntity(goodManifest(), { npub: other });
    const res = verifyManifest(signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(m)));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/npub does not match/);
  });
});

describe('B2 — the d tag is the full normalised hostname', () => {
  const withPage = (page: string) =>
    buildBusinessManifest({ name: 'Acme', page }) as Parameters<typeof manifestDTag>[0];

  it('www.a.com and www.b.com no longer collide', () => {
    expect(manifestDTag(withPage('https://www.a.com'))).toBe('a.com');
    expect(manifestDTag(withPage('https://www.b.com'))).toBe('b.com');
  });

  it('acme.com and acme.ca no longer collide', () => {
    expect(manifestDTag(withPage('https://acme.com/'))).not.toBe(manifestDTag(withPage('https://acme.ca/')));
  });

  it('keeps sub-domains, lowercases, drops port, path and trailing dot', () => {
    expect(manifestDTag(withPage('https://joes.example.com'))).toBe('joes.example.com');
    expect(manifestDTag(withPage('HTTPS://Shop.Acme.COM.:8443/x?y#z'))).toBe('shop.acme.com');
  });

  it('strips exactly one leading www. and only when a registrable host remains', () => {
    expect(manifestDTag(withPage('https://www.acme.com'))).toBe(manifestDTag(withPage('https://acme.com')));
    expect(manifestDTag(withPage('https://www.www.acme.com'))).toBe('www.acme.com');
    expect(manifestDTag(withPage('https://www.com'))).toBe('www.com');
  });

  it('falls back to the name slug when there is no http(s) page', () => {
    expect(manifestDTag(buildBusinessManifest({ name: "Joe's Plumbing" }))).toBe('_joe-s-plumbing');
    expect(manifestDTag(withPage('ftp://acme.com'))).toBe('_acme');
  });

  it('signManifest uses it by default', () => {
    const ev = signManifest(goodManifest(), bytesToHex(sk));
    expect(ev.tags).toEqual([['d', 'joes.example.com']]);
    expect(verifyManifest(ev).valid).toBe(true);
  });

  it('legacyManifestDTag reproduces the 0.1.x rule so old events stay findable/replaceable', () => {
    expect(legacyManifestDTag(withPage('https://www.acme.com'))).toBe('www');
    expect(legacyManifestDTag(withPage('https://joes.example.com'))).toBe('joes');
    const m = goodManifest();
    const ev = signManifest(m, bytesToHex(sk), { dTag: legacyManifestDTag(m) });
    expect(ev.tags).toEqual([['d', 'joes']]);
    expect(verifyManifest(ev).valid).toBe(true);
  });
});

describe('check round — hardening', () => {
  it('bindEntity refuses a payVia outside CHANNEL_VIA', () => {
    expect(() =>
      bindEntity(goodManifest(), {
        npub,
        payAddress: 'bc1qexampleaddr',
        payAsset: 'BTC',
        payVia: 'lightning' as never,
      }),
    ).toThrow(/payVia must be one of/);
    const ok = bindEntity(goodManifest(), { npub, payAddress: 'pay@x.ca', payAsset: 'BTC', payVia: 'interac' });
    expect(verifyManifest(signManifest(ok, bytesToHex(sk))).valid).toBe(true);
  });

  it('hashes the checked values: a getter that changes kind, or tags with toJSON, is rejected', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    let reads = 0;
    const tricky = { ...ev } as Record<string, unknown>;
    delete tricky.kind;
    Object.defineProperty(tricky, 'kind', { enumerable: true, get: () => (reads++ === 0 ? MANIFEST_KIND : 1) });
    expect(verifyManifest(tricky as unknown as NostrEvent).valid).toBe(false);

    const tags = [['d', 'joes.example.com']] as string[][] & { toJSON?: () => unknown };
    tags.toJSON = () => [['d', 'x'], ['d', 'y']];
    expect(verifyManifest({ ...ev, tags }).valid).toBe(false);

    const sparse = [['d', 'joes.example.com']] as string[][];
    sparse.length = 2; // a hole
    expect(verifyManifest({ ...ev, tags: sparse }).valid).toBe(false);
    expect(verifyManifest(JSON.parse(JSON.stringify(ev))).valid).toBe(true);
  });

  it('accepts an event built in another realm (node:vm) — no prototype-identity checks', () => {
    const ev = signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], JSON.stringify(goodManifest()));
    const foreign = vm.runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(ev))})`);
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    expect(verifyManifest(foreign).valid).toBe(true);
    // ...but getters from the other realm are still refused.
    const foreignGetter = vm.runInNewContext(
      `(() => { const e = JSON.parse(${JSON.stringify(JSON.stringify(ev))}); let n = 0;
        Object.defineProperty(e, 'kind', { get: () => (n++ ? 1 : ${MANIFEST_KIND}) }); return e; })()`,
    );
    expect(verifyManifest(foreignGetter).valid).toBe(false);
  });

  it('rejects duplicate keys (top level, identity, anywhere) and __proto__ keys in content', () => {
    const body = JSON.stringify(goodManifest());
    const dupTop = body.replace(/^\{/, '{"identity":{"name":"Other","nostr":{"npub":"npub1other"}},');
    const dupIdentity = body.replace('"identity":{', '"identity":{"name":"First",');
    const escapedDup = body.replace(/^\{/, '{"\\u0073chema":"bpub-business/0.1",');
    const proto = body.replace('"identity":{', '"identity":{"__proto__":{"admin":true},');
    for (const c of [dupTop, dupIdentity, escapedDup, proto]) {
      const res = verifyManifest(signRaw(MANIFEST_KIND, [['d', 'joes.example.com']], c));
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/duplicate or forbidden key/);
    }
    // Strings that merely LOOK like keys are fine.
    const m = bindEntity(goodManifest(), { npub });
    (m.identity as unknown as Record<string, unknown>).description = '"name":"x","name":"y" {"__proto__":1}';
    expect(verifyManifest(signRaw(MANIFEST_KIND, [['d', 'a']], JSON.stringify(m))).valid).toBe(true);
  });

  it('signManifest refuses an empty or non-string dTag', () => {
    expect(() => signManifest(goodManifest(), bytesToHex(sk), { dTag: '' })).toThrow(/dTag/);
    expect(() => signManifest(goodManifest(), bytesToHex(sk), { dTag: 5 as never })).toThrow(/dTag/);
  });

  it('manifestDTag refuses URLs the parser would repair, falling back to the name slug', () => {
    const withPage = (page: string) => buildBusinessManifest({ name: 'Acme', page });
    for (const page of [
      ' https://acme.com',
      'https://acme.com ',
      'https:acme.com',
      'https:\\\\acme.com',
      'https://ac\tme.com',
      'https://..com',
    ]) {
      expect(manifestDTag(withPage(page)), JSON.stringify(page)).toBe('_acme');
    }
    expect(manifestDTag(withPage('https://acme.com.'))).toBe('acme.com');
  });

  it('name-slug fallback keeps non-ASCII names distinct, stable and bounded', () => {
    const slug = (name: string) => manifestDTag(buildBusinessManifest({ name }));
    expect(slug('東京')).toMatch(/^__[0-9a-f]{16}$/);
    expect(new Set([slug('東a京'), slug('a東京'), slug('東京a'), slug('東京'), slug('大阪')]).size).toBe(5);
    expect(slug('Café René')).not.toBe(slug('Caf Ren'));
    expect(slug('Café')).not.toBe(slug('Cafe'));
    expect(slug('Café')).toMatch(/^_cafe_[0-9a-f]{16}$/);
    expect(slug('Caf\u00e9')).toBe(slug('Cafe\u0301')); // NFC and NFD spellings agree
    expect(slug('Acme Plumbing')).toBe('_acme-plumbing');
    expect(slug('\ud800')).toBe(slug('\ud800')); // lone surrogate: deterministic
    for (const n of ['\ufdfa'.repeat(100), 'a'.repeat(500), 'ab-'.repeat(200) + '東']) {
      expect(slug(n).length).toBeLessThanOrEqual(65);
    }
  });

  it('a name-derived tag can never equal a hostname-derived one', () => {
    const host = manifestDTag(buildBusinessManifest({ name: 'Acme', page: 'https://acme' }));
    const name = manifestDTag(buildBusinessManifest({ name: 'Acme' }));
    expect(host).toBe('acme');
    expect(name).toBe('_acme');
  });

  it('legacyManifestDTag stays exact, including the non-ASCII → "business" collapse', () => {
    expect(legacyManifestDTag(buildBusinessManifest({ name: '東京' }))).toBe('business');
    expect(legacyManifestDTag(buildBusinessManifest({ name: 'Café René' }))).toBe('caf-ren');
    const odd = { ...buildBusinessManifest({ name: 'X' }), identity: { name: 'X', page: ['https://x.com'] } };
    expect(legacyManifestDTag(odd as never)).toBe('x');
  });

  it('page-less manifests (resilience.canonical null) do not verify', () => {
    const m = bindEntity(buildBusinessManifest({ name: 'No Page' }), { npub });
    const res = verifyManifest(signManifest(m, bytesToHex(sk)));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/resilience.canonical is required/);
  });
});

describe('key scanner bounds', () => {
  it('terminates on truncated input when called directly', () => {
    expect(findDuplicateOrProtoKey('{"a')).toBeNull();
    expect(findDuplicateOrProtoKey('{"a\\')).toBeNull();
    expect(findDuplicateOrProtoKey('{"a":1,"a')).toBeNull();
    expect(findDuplicateOrProtoKey('"')).toBeNull();
  });
});
