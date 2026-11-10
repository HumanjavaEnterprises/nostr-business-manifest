/**
 * The signing / binding gates:
 *   - sign → verify round-trip (valid, npub, original manifest returned)
 *   - tamper → invalid (content, sig, id, pubkey, created_at)
 *   - binding integrity (manifest npub ≠ signing pubkey → rejected)
 *   - no-leak (no private key in any return value or thrown error)
 *   - private-key ingestion (hex AND nsec-bech32), rejection without echo
 */
import { describe, it, expect } from 'vitest';
import {
  buildBusinessManifest,
  bindEntity,
  deriveZpubAddress,
  signManifest,
  verifyManifest,
  npubOf,
  BindingError,
  InvalidPrivateKeyError,
} from '../src/index.js';
// @ts-expect-error — plain JS fixtures.
import { SIGNER, OTHER_NPUB } from './vectors.mjs';

function boundManifest() {
  // A caller-supplied hostBase gives the manifest a page (https://joes.example.com),
  // from which the signed event's `d` tag (the full hostname) is derived.
  const base = buildBusinessManifest({
    slug: 'joes',
    name: 'Joe’s Plumbing',
    verified: true,
    hostBase: 'example.com',
  });
  return bindEntity(base, { npub: SIGNER.npub });
}

describe('sign → verify round-trip', () => {
  it('signs with a hex key and verifies valid, returning the npub + original manifest', () => {
    const manifest = boundManifest();
    const event = signManifest(manifest, SIGNER.skHex);

    expect(event.pubkey).toBe(SIGNER.pubkey);
    expect(event.kind).toBe(30078);
    expect(event.tags).toEqual([['d', 'joes.example.com']]); // full host (0.2.0)

    const res = verifyManifest(event);
    expect(res.valid).toBe(true);
    expect(res.npub).toBe(SIGNER.npub);
    expect(res.manifest).toEqual(manifest);
  });

  it('signs with an nsec-bech32 key and verifies valid', () => {
    const manifest = boundManifest();
    const event = signManifest(manifest, SIGNER.nsec);
    expect(event.pubkey).toBe(SIGNER.pubkey);
    expect(verifyManifest(event).valid).toBe(true);
  });

  it('npubOf(event.pubkey) equals the signer npub', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    expect(npubOf(event.pubkey)).toBe(SIGNER.npub);
  });
});

describe('tamper detection', () => {
  it('rejects tampered content', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    const tampered = { ...event, content: event.content.replace('Joe', 'Moe') };
    expect(verifyManifest(tampered).valid).toBe(false);
  });

  it('rejects a flipped signature', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    const sig = event.sig.slice(0, -2) + (event.sig.endsWith('0') ? '1' : '0');
    expect(verifyManifest({ ...event, sig }).valid).toBe(false);
  });

  it('rejects a mutated created_at (id no longer matches)', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    expect(verifyManifest({ ...event, created_at: event.created_at + 1 }).valid).toBe(false);
  });

  it('rejects a swapped pubkey', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(verifyManifest({ ...event, pubkey: other }).valid).toBe(false);
  });
});

describe('binding integrity', () => {
  it('rejects an event whose manifest npub ≠ the signing pubkey', () => {
    // Bind the manifest to a DIFFERENT npub than the key that signs it.
    const base = buildBusinessManifest({ slug: 'joes', name: 'Joe’s Plumbing' });
    const misbound = bindEntity(base, { npub: OTHER_NPUB });
    const event = signManifest(misbound, SIGNER.skHex); // signed by SIGNER, claims OTHER

    const res = verifyManifest(event);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/npub does not match/i);
  });

  it('rejects an UNBOUND manifest (no identity.nostr.npub) — bind before signing', () => {
    const unbound = buildBusinessManifest({ slug: 'joes', name: 'Joe’s Plumbing' });
    expect(unbound.identity.nostr).toBeNull();
    const event = signManifest(unbound, SIGNER.skHex);
    expect(verifyManifest(event).valid).toBe(false);
  });
});

describe('no-leak — the private key never appears in output or errors', () => {
  it('the signed event carries no private key material', () => {
    const event = signManifest(boundManifest(), SIGNER.skHex);
    const json = JSON.stringify(event);
    expect(json).not.toContain(SIGNER.skHex);
    expect(json).not.toContain(SIGNER.nsec);
    expect(json.toLowerCase()).not.toContain('nsec1');
  });

  it('a rejecting error never echoes the supplied key', () => {
    const badButRealKey = SIGNER.skHex; // valid hex — but pass it as a "public" mistake path
    // Feed a clearly-invalid private key and assert the error omits it.
    const junk = 'nsec1' + 'q'.repeat(58);
    let msg = '';
    try {
      signManifest(boundManifest(), junk);
    } catch (e) {
      msg = (e as Error).message + ' ' + String(e);
    }
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toContain(junk);
    // A wrong-but-real hex key routed to the public-key branch also must not echo.
    let msg2 = '';
    try {
      signManifest(boundManifest(), SIGNER.npub); // an npub is not a private key
    } catch (e) {
      msg2 = (e as Error).message + ' ' + String(e);
    }
    expect(msg2).not.toContain(SIGNER.npub);
    expect(msg2).not.toContain(badButRealKey);
  });

  it('rejects non-private-key input with InvalidPrivateKeyError', () => {
    expect(() => signManifest(boundManifest(), '')).toThrow(InvalidPrivateKeyError);
    expect(() => signManifest(boundManifest(), 'not-a-key')).toThrow(InvalidPrivateKeyError);
    expect(() => signManifest(boundManifest(), SIGNER.npub)).toThrow(InvalidPrivateKeyError);
    expect(() => signManifest(boundManifest(), 'deadbeef')).toThrow(InvalidPrivateKeyError);
  });
});

describe('bindEntity', () => {
  const ZPUB =
    'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

  it('sets identity.nostr.npub without mutating the input', () => {
    const base = buildBusinessManifest({ slug: 'joes', name: 'Joe' });
    const bound = bindEntity(base, { npub: SIGNER.npub });
    expect(bound.identity.nostr?.npub).toBe(SIGNER.npub);
    expect(base).not.toBe(bound);
  });

  it('embeds a pre-derived payAddress on channels.pay', () => {
    const base = buildBusinessManifest({ slug: 'joes', name: 'Joe' });
    const bound = bindEntity(base, { npub: SIGNER.npub, payAddress: 'bc1qexampleaddr', payAsset: 'BTC' });
    expect(bound.channels.pay?.via).toBe('onchain');
    expect(bound.channels.pay?.endpoint).toBe('bc1qexampleaddr');
    expect(bound.channels.pay?.asset).toBe('BTC');
  });

  it('SECURITY: payAddress without payAsset is refused (no silent BTC default)', () => {
    const base = buildBusinessManifest({ slug: 'joes', name: 'Joe' });
    // @ts-expect-error — payAsset intentionally omitted to prove the runtime guard
    expect(() => bindEntity(base, { npub: SIGNER.npub, payAddress: 'bc1qexampleaddr' })).toThrow(BindingError);
  });

  it('SECURITY: deriveZpubAddress refuses a missing asset (no silent BTC default)', async () => {
    // @ts-expect-error — asset intentionally omitted to prove the runtime guard
    await expect(deriveZpubAddress(ZPUB)).rejects.toBeInstanceOf(BindingError);
  });

  it('SECURITY: a raw zpub is NEVER embedded — bindEntity throws and writes nothing', () => {
    const base = buildBusinessManifest({ slug: 'joes', name: 'Joe' });
    let thrown: unknown;
    try {
      bindEntity(base, { npub: SIGNER.npub, zpubBTC: ZPUB } as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BindingError);
    // The raw zpub must not appear in the error message either.
    expect(String(thrown)).not.toContain(ZPUB);
    // And the input manifest is untouched — no pay channel got the zpub.
    expect(JSON.stringify(base)).not.toContain(ZPUB);
  });

  it('SECURITY: an extended key passed as payAddress is refused', () => {
    const base = buildBusinessManifest({ name: 'Joe' });
    expect(() => bindEntity(base, { npub: SIGNER.npub, payAddress: ZPUB })).toThrow(BindingError);
  });

  it('rejects a non-npub binding target', () => {
    const base = buildBusinessManifest({ name: 'Joe' });
    expect(() => bindEntity(base, { npub: 'not-an-npub' } as any)).toThrow();
  });

  it('deriveZpubAddress throws a clear error (never returns the raw zpub) when the peer is absent', async () => {
    // nostr-zpub-utils is not installed in this repo → derivation is unavailable.
    await expect(deriveZpubAddress(ZPUB, 'BTC')).rejects.toBeInstanceOf(BindingError);
    await expect(deriveZpubAddress(ZPUB, 'BTC')).rejects.not.toThrow(ZPUB);
  });
});

describe('out-of-range private key', () => {
  it('rejects zero and n and above with InvalidPrivateKeyError (not a raw noble error)', () => {
    const manifest = boundManifest();
    const zero = '0'.repeat(64);
    const n = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'; // == order n
    expect(() => signManifest(manifest, zero)).toThrow(InvalidPrivateKeyError);
    expect(() => signManifest(manifest, n)).toThrow(InvalidPrivateKeyError);
  });
});
