/**
 * The signing / binding layer.
 *
 * `bindEntity` and `verifyManifest` are pure and safe to run anywhere — they touch
 * only PUBLIC material. `signManifest` is the ONE function that touches a private
 * key: it accepts an `nsec`, uses it to schnorr-sign the event, and lets it go out
 * of scope. The `nsec` is never stored on the returned event, never logged, and
 * never placed in an error message (see SPEC "The boundary" and the no-leak test).
 *
 * @packageDocumentation
 */

import {
  schnorr,
  bytesToHex,
  hexToBytes,
  sha256,
  computeEventId,
  normalizePrivateKey,
  npubOf,
  pubkeyOfNpub,
  InvalidPublicKeyError,
} from './nostr.js';
import { validateBusinessManifest } from './validate.js';
import { CHANNEL_VIA } from './schema.js';
import type {
  BusinessManifest,
  BindOptions,
  NostrEvent,
  SignOptions,
  VerifyResult,
} from './types.js';

export { npubOf, pubkeyOfNpub } from './nostr.js';
export {
  InvalidPrivateKeyError,
  InvalidPublicKeyError,
} from './nostr.js';

/**
 * The event kind for a signed business manifest — a parameterized-replaceable
 * event (NIP-01 range 30000–39999), so re-signing the same business (same `d`
 * tag) replaces the prior event on a relay. 30078 is the NIP-78 app-specific
 * "arbitrary custom app data" kind.
 */
export const MANIFEST_KIND = 30078;

/** Slug of the business name — the `d` tag fallback when the manifest has no http(s) page. */
function legacyNameSlug(manifest: BusinessManifest): string {
  const name = manifest?.identity?.name || 'business';
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'business'
  );
}

/**
 * Stable slug of `identity.name`, always starting with `_` so it can never equal a
 * hostname-derived tag (hostnames cannot contain `_`).
 *
 * - Pure-ASCII names: `_` + the lowercase letters/digits joined by `-`, at most 64 chars
 *   after the `_` (`Joe's Plumbing` → `_joe-s-plumbing`).
 * - Names with any non-ASCII character: `_` + the ASCII part of the NFKD form (at most
 *   47 chars) + `_` + the first 16 hex chars of sha256(UTF-8(NFKD(name).toLowerCase()))
 *   (`東京` → `__<16 hex>`, `Café` → `_cafe_<16 hex>`). NFC and NFD spellings agree; lone
 *   surrogates are encoded as U+FFFD by `TextEncoder`, so the result is deterministic.
 *
 * The result is at most 65 characters. ASCII-only names that differ only in
 * punctuation/spacing still share a slug, as in 0.1.x.
 */
function nameSlug(manifest: BusinessManifest): string {
  const raw = manifest?.identity?.name;
  const name = typeof raw === 'string' && raw.length > 0 ? raw : 'business';
  const folded = name.normalize('NFKD').toLowerCase();
  const asciiSlug = (max: number) =>
    folded
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, max)
      .replace(/-+$/, '');
  // eslint-disable-next-line no-control-regex -- "any non-ASCII" is the test
  if (!/[^\x00-\x7f]/.test(folded)) return `_${asciiSlug(64) || 'business'}`;
  const hash = bytesToHex(sha256(new TextEncoder().encode(folded))).slice(0, 16);
  return `_${asciiSlug(47)}_${hash}`;
}

/** The manifest's page URL (or canonical URL), or '' when neither is a string. */
function pageUrlOf(manifest: BusinessManifest): string {
  const url = manifest?.identity?.page || manifest?.resilience?.canonical || '';
  return typeof url === 'string' ? url : '';
}

/**
 * The full, normalised hostname of an http(s) URL: lowercased (and punycoded) by the
 * WHATWG URL parser, without port, path, or trailing dot, and with ONE leading `www.`
 * removed when a dotted host remains (`www.acme.com` → `acme.com`, but `www.com` stays).
 * Returns null for anything that is not an absolute http(s) URL.
 */
function normalisedHostOf(url: string): string | null {
  // Refuse what the WHATWG parser would silently repair: leading/trailing or inner
  // whitespace and control characters, backslashes, and a missing `//`.
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (!/^https?:\/\/[^\x00-\x20\x7f\\]+$/i.test(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('.') || host.includes('..')) return null;
  if (host.startsWith('www.') && host.slice(4).includes('.')) host = host.slice(4);
  return host;
}

/**
 * The default `d` tag for a manifest event: the full normalised hostname of the
 * manifest's page (or canonical) URL — `https://www.Acme.com:443/x` → `acme.com`,
 * `https://joes.example.com` → `joes.example.com`. One leading `www.` is stripped, so a
 * business's `www.` and bare host map to the same event. Falls back to a slug of
 * `identity.name` when there is no http(s) page.
 *
 * Changed in 0.2.0 — 0.1.x used only the FIRST DNS label (so every `www.` page got
 * `d="www"`). See {@link legacyManifestDTag} to find or replace events signed by 0.1.x.
 */
export function manifestDTag(manifest: BusinessManifest): string {
  return normalisedHostOf(pageUrlOf(manifest)) ?? nameSlug(manifest);
}

/**
 * The `d` tag that 0.1.x derived for a manifest (the first DNS label of the page URL,
 * e.g. `https://www.acme.com` → `www`). Use it to look up events published with 0.1.x,
 * or pass it as `signManifest(m, nsec, { dTag: legacyManifestDTag(m) })` to keep
 * replacing such an event in place. New events should use {@link manifestDTag}.
 *
 * @deprecated only for compatibility with events signed by 0.1.x.
 */
export function legacyManifestDTag(manifest: BusinessManifest): string {
  // Byte-for-byte the 0.1.x rule (including RegExp's string coercion of a non-string page).
  const url = manifest?.identity?.page || manifest?.resilience?.canonical || '';
  const sub = /^https?:\/\/([^./]+)\./i.exec(url as string);
  if (sub) return sub[1];
  return legacyNameSlug(manifest);
}

/** Thrown when a manifest cannot be safely bound (e.g. a raw extended key was passed). */
export class BindingError extends Error {
  /** The underlying error, when this wraps one (e.g. the peer's `NonBip84KeyError`). */
  readonly cause?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'BindingError';
    if (options && 'cause' in options) this.cause = options.cause;
    Object.setPrototypeOf(this, BindingError.prototype);
  }
}

/** True when a string looks like an extended PUBLIC key (a zpub/xpub/…), not an address. */
function looksExtendedKey(s: string): boolean {
  return /^(zpub|xpub|ypub|vpub|tpub|upub|ltub|mtub)[0-9a-z]/i.test(s);
}

/**
 * Bind an entity's identity and receiving key into a manifest. Pure — no private key.
 *
 * Sets `identity.nostr.npub` to the given npub. For the pay channel, pass a
 * **pre-derived receiving `payAddress`** (recommended) — a single address is what a
 * public, relayed manifest should carry.
 *
 * ⛔ A raw extended public key (`zpub`/`xpub`) is NEVER embedded: it exposes the
 * business's entire receive-address chain. If `zpubBTC`/`zpubLTC` (or a `payAddress`
 * that is itself an extended key) is supplied, `bindEntity` THROWS a {@link BindingError}
 * and writes nothing — derive one address first with {@link deriveZpubAddress} (which
 * only works when the optional `nostr-zpub-utils` peer is installed) and pass it
 * as `{ payAddress }`. Returns a NEW manifest — the input is not mutated.
 *
 * @param manifest - the manifest to bind
 * @param opts - `{ npub, payAddress?, payAsset?, payVia? }`
 * @returns a new, bound manifest
 */
export function bindEntity(manifest: BusinessManifest, opts: BindOptions): BusinessManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('bindEntity: manifest must be an object');
  }
  if (!opts || typeof opts.npub !== 'string' || !opts.npub.startsWith('npub1')) {
    throw new InvalidPublicKeyError('bindEntity: opts.npub must be a bech32 npub');
  }
  // Validate the npub decodes (throws on a malformed value).
  pubkeyOfNpub(opts.npub);

  // Hard invariant: a raw extended public key must NEVER reach a public manifest.
  if (opts.zpubBTC || opts.zpubLTC) {
    throw new BindingError(
      'bindEntity will not embed a raw extended public key (zpub/xpub) — it exposes the ' +
        'entire receive-address chain in a public, relayed manifest. Derive a single ' +
        'receiving address first (e.g. `await deriveZpubAddress(zpub, asset)`, which needs ' +
        'the optional nostr-zpub-utils peer) and pass it as { payAddress }. Nothing was written.',
    );
  }

  const next: BusinessManifest = structuredClone(manifest);

  const prevNip05 = next.identity?.nostr?.nip05 ?? null;
  next.identity.nostr = { npub: opts.npub, nip05: prevNip05 };

  if (opts.payAddress != null) {
    if (typeof opts.payAddress !== 'string' || opts.payAddress.length === 0) {
      throw new BindingError('bindEntity: payAddress must be a non-empty string');
    }
    if (looksExtendedKey(opts.payAddress)) {
      throw new BindingError(
        'bindEntity: payAddress looks like an extended public key (zpub/xpub). Pass a ' +
          'single derived receiving ADDRESS, not an extended key. Nothing was written.',
      );
    }
    // `payAsset` is REQUIRED with a payAddress. A silent default would let a BTC address
    // be labelled LTC (or vice versa) in a public, machine-read manifest — a paying agent
    // could then send funds on the wrong chain. Make the caller state the chain.
    if (opts.payAsset !== 'BTC' && opts.payAsset !== 'LTC') {
      throw new BindingError(
        "bindEntity: payAsset is required with payAddress — pass { payAsset: 'BTC' | 'LTC' }. " +
          'Nothing was written.',
      );
    }
    if (opts.payVia !== undefined && !CHANNEL_VIA.includes(opts.payVia)) {
      throw new BindingError(
        `bindEntity: payVia must be one of ${CHANNEL_VIA.join('|')} (got ${JSON.stringify(opts.payVia)}). ` +
          'Nothing was written.',
      );
    }
    const prevPay = next.channels.pay ?? {};
    next.channels.pay = {
      ...prevPay,
      via: opts.payVia ?? 'onchain',
      endpoint: opts.payAddress,
      asset: opts.payAsset,
    };
  }

  return next;
}

/**
 * Derive a single receiving ADDRESS from an extended public key (`zpub`) — the safe
 * input for {@link bindEntity}'s `payAddress`.
 *
 * This is a convenience over the OPTIONAL `nostr-zpub-utils` peer, loaded via a
 * dynamic `import()` so it works in ESM and CJS and is absent-tolerant. If the peer
 * is not installed, it throws a clear {@link BindingError} — it NEVER returns the raw
 * `zpub`. Pure/public: no seed, no private key.
 *
 * @param zpub - an extended PUBLIC key
 * @param asset - `'BTC'` or `'LTC'` — REQUIRED; the chain is never guessed
 * @param opts - optional `{ index, change }` (defaults `0` / `0`)
 * @returns the first (or requested) receiving address
 */
export async function deriveZpubAddress(
  zpub: string,
  asset: 'BTC' | 'LTC',
  opts: { index?: number; change?: 0 | 1 } = {},
): Promise<string> {
  if (asset !== 'BTC' && asset !== 'LTC') {
    throw new BindingError("deriveZpubAddress: asset is required — pass 'BTC' or 'LTC'. The chain is never guessed.");
  }
  let peer: any;
  try {
    // Indirect specifier: resolved only at runtime (the peer is optional and may be
    // absent), so neither tsc nor the bundler tries to hard-link it at build time.
    const spec = 'nostr-zpub-utils';
    peer = await import(/* @vite-ignore */ /* webpackIgnore: true */ spec);
  } catch {
    throw new BindingError(
      'deriveZpubAddress requires the optional peer "nostr-zpub-utils". Install it ' +
        '(npm install nostr-zpub-utils), or pass an already-derived address to ' +
        'bindEntity({ payAddress }).',
    );
  }
  const fn = peer?.zpubToAddress ?? peer?.default?.zpubToAddress;
  if (typeof fn !== 'function') {
    throw new BindingError('nostr-zpub-utils did not export zpubToAddress');
  }
  try {
    // Never pass the peer's `allowNonBip84` opt-in: only a BIP-84 zpub/vpub is accepted.
    return await fn(zpub, { asset, index: opts.index ?? 0, change: opts.change ?? 0 });
  } catch (e) {
    if ((e as { name?: unknown })?.name === 'NonBip84KeyError') {
      throw new BindingError(
        'deriveZpubAddress: nostr-zpub-utils refused the key (NonBip84KeyError) — only a BIP-84 ' +
          'zpub/vpub is accepted. Export the native-SegWit (BIP-84) account key from the wallet.',
        { cause: e },
      );
    }
    throw e;
  }
}

/**
 * Sign a manifest as a NIP-01 Nostr event with schnorr (BIP340).
 *
 * ⛔ ENCLAVE / CLIENT ONLY. This is the only function that touches a private key.
 * The `nsec` (bech32 or 64-char hex) is decoded, used to derive the pubkey and
 * produce the signature, and then dropped — it is never stored on the returned
 * event, logged, or included in any error. The returned {@link NostrEvent} is
 * PUBLIC and publishable to relays.
 *
 * @param manifest - the manifest to sign (its JSON becomes the event content)
 * @param nsec - the signer's private key (`nsec…` bech32 or 32-byte hex)
 * @param opts - optional `created_at` / `dTag` overrides
 * @returns the signed, public Nostr event
 */
export function signManifest(
  manifest: BusinessManifest,
  nsec: string,
  opts: SignOptions = {},
): NostrEvent {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('signManifest: manifest must be an object');
  }

  if (opts.dTag !== undefined && (typeof opts.dTag !== 'string' || opts.dTag.length === 0)) {
    throw new TypeError('signManifest: opts.dTag must be a non-empty string');
  }

  // Decode the private key. `sk` is the ONLY private value in this function and is
  // never returned or logged. normalizePrivateKey throws WITHOUT echoing the input.
  const sk = normalizePrivateKey(nsec);
  try {
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const created_at = opts.created_at ?? Math.floor(Date.now() / 1000);
    const dTag = opts.dTag ?? manifestDTag(manifest);
    const tags: string[][] = [['d', dTag]];
    const content = JSON.stringify(manifest);

    const id = computeEventId({ pubkey, created_at, kind: MANIFEST_KIND, tags, content });
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));

    return { id, pubkey, created_at, kind: MANIFEST_KIND, tags, content, sig };
  } finally {
    // Zero the scalar bytes so no copy lingers in the buffer after the call.
    sk.fill(0);
  }
}

/** Read an OWN data property; throw on an accessor (getter). Missing → undefined. */
function ownData(o: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, key);
  if (!d) return undefined;
  if (!('value' in d)) throw new TypeError(`${key} is an accessor`);
  return d.value;
}

/** Copy a plain array via own data properties, or null if it is not one (holes, getters, toJSON). */
function copyPlainArray(v: unknown): unknown[] | null {
  if (!Array.isArray(v)) return null;
  if (Object.getOwnPropertyDescriptor(v, 'toJSON')) return null;
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !('value' in d)) return null;
    out.push(d.value);
  }
  return out;
}

/** Copy `tags` as fresh string[][] or return null when it is not exactly that. */
function copyTags(v: unknown): string[][] | null {
  const outer = copyPlainArray(v);
  if (!outer) return null;
  const out: string[][] = [];
  for (const t of outer) {
    const inner = copyPlainArray(t);
    if (!inner || !inner.every((x) => typeof x === 'string')) return null;
    out.push(inner as string[]);
  }
  return out;
}

/**
 * Scan ALREADY-VALID JSON text and return the first object key that is `__proto__` or
 * repeats within the same object (compared after unescaping), or null. Linear, no recursion.
 * Never loops past the end, even on truncated input.
 *
 * @internal exported for tests only; not part of the package API (not re-exported by index).
 */
export function findDuplicateOrProtoKey(json: string): string | null {
  const stack: Array<Set<string> | null> = []; // Set = object (its keys so far), null = array
  let expectKey = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === '"') {
      let j = i + 1;
      let escaped = false;
      while (j < json.length && json[j] !== '"') {
        if (json[j] === '\\') {
          escaped = true;
          j += 2;
        } else j++;
      }
      if (j >= json.length) return null; // unterminated string: not valid JSON, nothing to report
      const top = stack[stack.length - 1];
      if (expectKey && top) {
        const key = escaped ? (JSON.parse(json.slice(i, j + 1)) as string) : json.slice(i + 1, j);
        if (key === '__proto__' || top.has(key)) return key;
        top.add(key);
        expectKey = false;
      }
      i = j;
    } else if (c === '{') {
      stack.push(new Set());
      expectKey = true;
    } else if (c === '[') {
      stack.push(null);
      expectKey = false;
    } else if (c === '}' || c === ']') {
      stack.pop();
      expectKey = false;
    } else if (c === ',') {
      expectKey = stack[stack.length - 1] instanceof Set;
    } else if (c === ':') {
      expectKey = false;
    }
  }
  return null;
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const LOWER_HEX_128 = /^[0-9a-f]{128}$/;

/**
 * Verify a signed manifest event. Pure — no private key.
 *
 * Returns `valid: true` only when ALL of these hold:
 *
 * 1. the event is well-formed: `id` and `pubkey` are 64 and `sig` 128 LOWERCASE hex
 *    chars, `kind` and `created_at` are integers, `tags` is an array of string arrays,
 *    `content` is a string;
 * 2. `kind === MANIFEST_KIND` (30078);
 * 3. there is exactly one `d` tag and its value is a non-empty string (any value — the
 *    signer may have overridden it, or signed with 0.1.x; see {@link manifestDTag});
 * 4. the recomputed NIP-01 id equals `id`, and the schnorr signature over it verifies
 *    against `pubkey`;
 * 5. `content` parses as JSON and the manifest's `identity.nostr.npub` equals
 *    `npubOf(event.pubkey)` — the card claims the identity that signed it;
 * 6. the manifest passes {@link validateBusinessManifest} (`schema` is
 *    `bpub-business/0.1`, and the required fields are present).
 *
 * @param event - the signed Nostr event
 * @returns `{ valid, npub, manifest, reason? }`
 */
export function verifyManifest(event: NostrEvent): VerifyResult {
  const fail = (reason: string, npub: string | null = null, manifest: BusinessManifest | null = null) =>
    ({ valid: false, npub, manifest, reason }) as VerifyResult;

  if (!event || typeof event !== 'object') return fail('event is not an object');

  // 1. Shape — read OWN DATA properties exactly once (no getters, no inherited values) and
  //    copy the tags, so the bytes hashed below are the bytes that were checked.
  let id: unknown, pubkey: unknown, sig: unknown, kind: unknown, created_at: unknown, content: unknown;
  let tags: string[][] | null;
  try {
    id = ownData(event, 'id');
    pubkey = ownData(event, 'pubkey');
    sig = ownData(event, 'sig');
    kind = ownData(event, 'kind');
    created_at = ownData(event, 'created_at');
    content = ownData(event, 'content');
    tags = copyTags(ownData(event, 'tags'));
  } catch {
    return fail('event fields must be plain data properties');
  }
  if (typeof id !== 'string' || !LOWER_HEX_64.test(id)) return fail('event id must be 64 lowercase hex chars');
  if (typeof pubkey !== 'string' || !LOWER_HEX_64.test(pubkey)) {
    return fail('event pubkey must be 64 lowercase hex chars');
  }
  if (typeof sig !== 'string' || !LOWER_HEX_128.test(sig)) return fail('event sig must be 128 lowercase hex chars');
  if (!Number.isSafeInteger(kind) || !Number.isSafeInteger(created_at)) {
    return fail('event kind and created_at must be integers');
  }
  if (tags === null) return fail('event tags must be an array of string arrays');
  if (typeof content !== 'string') return fail('event content must be a string');

  // 2. Kind — a text note (or any other kind) is not a business manifest.
  if (kind !== MANIFEST_KIND) return fail(`event kind must be ${MANIFEST_KIND}`);

  // 3. Exactly one non-empty `d` tag (parameterized-replaceable addressing).
  const dTags = tags.filter((t) => t[0] === 'd');
  if (dTags.length !== 1 || typeof dTags[0][1] !== 'string' || dTags[0][1].length === 0) {
    return fail('event must carry exactly one non-empty d tag');
  }

  // 4a. Recompute the id and check it matches the claimed id (tamper on any field).
  const checked = { pubkey, created_at: created_at as number, kind: kind as number, tags, content };
  if (computeEventId(checked) !== id) return fail('event id does not match content');

  // 4b. Schnorr-verify the signature over the id against the event pubkey.
  let sigOk: boolean;
  try {
    sigOk = schnorr.verify(hexToBytes(sig), hexToBytes(id), hexToBytes(pubkey));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail('schnorr signature is invalid');

  // 5a. Parse the manifest from content.
  let manifest: BusinessManifest;
  try {
    manifest = JSON.parse(content) as BusinessManifest;
  } catch {
    return fail('content is not valid JSON');
  }
  // 5a'. One meaning only: no duplicate keys (JSON.parse is last-wins, other parsers are
  //      not) and no `__proto__` keys, so `result.manifest` is a clean plain object that
  //      every reader of `content` would see the same way.
  const badKey = findDuplicateOrProtoKey(content);
  if (badKey !== null) return fail(`content has a duplicate or forbidden key: ${JSON.stringify(badKey)}`);
  const signerNpub = npubOf(pubkey);

  // 5b. Binding integrity: the manifest must claim the npub that signed it.
  const claimedNpub = manifest?.identity?.nostr?.npub ?? null;
  if (claimedNpub !== signerNpub) {
    return fail('manifest npub does not match the signing pubkey', signerNpub, manifest);
  }

  // 6. Schema: the content must actually be a bpub-business/0.1 manifest.
  const schema = validateBusinessManifest(manifest);
  if (!schema.valid) {
    return fail(`manifest fails the bpub-business schema: ${schema.errors.join('; ')}`, signerNpub, manifest);
  }

  return { valid: true, npub: signerNpub, manifest };
}
