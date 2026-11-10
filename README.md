# nostr-business-manifest

An open, host-agnostic library for **any Nostr platform where an `npub` represents a
business entity** — build its manifest, bind identity and receiving keys, sign it, and
verify it anywhere. Not tied to any one product: the library defines *what* the manifest
is and keeps every decision about *how* (which domain, which registry) in the caller's
hands, so each adopting platform supplies its own host.

Part of the `nostr-*` utilities set: `nostr-agentic-identity` (identity),
`nostr-zpub-utils` (BTC/LTC receiving keys), and this — the business manifest.

> **`bpub` is the format name, not a bech32 prefix.** The manifest is versioned
> `bpub-business/0.1`; it is not an encoding like `npub`/`nsec`. The npm package and repo are
> named `nostr-business-manifest` for exactly that reason — only the *format* keeps the `bpub-` name.

> The file an agent reads instead of emailing a business: its identity and its
> verb-typed, transactable **channels** (`book / pay / support / ask`), typically served
> at `/.well-known/info.json` — and, optionally, signed by the business's own key so any
> party can verify it without trusting the host that serves it.

## Two layers

**1 — the manifest (data, safe anywhere).** `buildBusinessManifest` / `validateBusinessManifest`
/ `linksToChannels` produce and validate the `bpub-business/0.1` manifest.

**2 — the signature (verifiable, enclave-side to sign).** `bindEntity` attaches an `npub`
and, optionally, a pre-derived receiving **address** for the pay channel; `signManifest`
schnorr-signs the manifest as a Nostr event; `verifyManifest` checks the event kind, the `d`
tag, the signature, the manifest schema, and that the manifest claims the same identity that
signed it.

## Install

```sh
npm i nostr-business-manifest
```

## Use

```js
import { buildBusinessManifest, validateBusinessManifest } from 'nostr-business-manifest';

const manifest = buildBusinessManifest({
  slug: 'joes', name: "Joe's Plumbing", category: 'plumber', geo: 'toronto',
  languages: ['en', 'fr'],
  hostBase: 'example.com', // YOUR platform's host — the page becomes https://joes.example.com
  links: [
    { kind: 'website', url: 'https://joes.example.com' },
    { kind: 'booking', url: 'https://book.example.com/joes' },
    { kind: 'other',   url: 'mailto:hi@joes.example.com' }, // → channels.support
  ],
});

const { valid, errors } = validateBusinessManifest(manifest);
```

The library never fabricates a domain. Supply your own host with `hostBase` (a bare host
like `"acme.example"`) and a `page` is derived from the `slug` as `https://${slug}.${hostBase}`;
`resilience.registry` defaults to `https://${hostBase}`. Pass an explicit `page` and/or
`registry` to set them directly. With none of these, `page` is `null` and `registry` is
omitted — no host is invented.

Sign it (enclave/client-side — the `nsec` is used and discarded):

```js
import { bindEntity, signManifest, verifyManifest } from 'nostr-business-manifest';

// Pass a pre-derived receiving ADDRESS (recommended). Never a raw zpub — bindEntity
// refuses to embed one, since a zpub exposes the whole receive-address chain.
const bound = bindEntity(manifest, { npub, payAddress, payAsset: 'BTC' });
const event = signManifest(bound, nsec);                 // schnorr-signed Nostr event
// ...publish `event` to relays...

const { valid, npub: signer, manifest: m } = verifyManifest(event); // anyone, no host
```

To turn a `zpub` into a single address first (needs the optional `nostr-zpub-utils`
peer), use `deriveZpubAddress`:

```js
import { deriveZpubAddress, bindEntity } from 'nostr-business-manifest';
const payAddress = await deriveZpubAddress(zpubBTC, 'BTC'); // throws if the peer is absent
const bound = bindEntity(manifest, { npub, payAddress, payAsset: 'BTC' });
```

## API

- `buildBusinessManifest(input)` → a `bpub-business/0.1` manifest. Accepts identity fields
  plus either `links:[{kind,url}]` (auto-mapped to channels) or explicit `channels:{}`.
  Host is caller-supplied via `hostBase` (or an explicit `page`/`registry`); no domain is
  ever hardcoded.
- `linksToChannels(links, { pageUrl })` → the verb-typed channels map.
- `validateBusinessManifest(m)` → `{ valid, errors }` (structural).
- `bindEntity(manifest, { npub, payAddress?, payAsset?, payVia? })` → manifest with
  identity set and, if a pre-derived `payAddress` is given, a pay channel. A raw
  extended key (`zpub`/`xpub`) is refused, never embedded.
- `deriveZpubAddress(zpub, asset, { index?, change? })` → a single receiving address for use
  as `payAddress`. `asset` (`'BTC'` | `'LTC'`) is required. Needs the optional
  `nostr-zpub-utils` peer (`>=0.1.0 <0.3.0`); throws if it is absent. Only a BIP-84
  `zpub`/`vpub` is accepted: with nostr-zpub-utils 0.2.x any other key (`xpub`, `Ltub`, …)
  throws a `BindingError` whose `cause` is the peer's `NonBip84KeyError`.
- `signManifest(manifest, nsec, { created_at?, dTag? })` → a schnorr-signed Nostr event
  (kind `30078`, one `d` tag). **Enclave/client-only.**
- `verifyManifest(event)` → `{ valid, npub, manifest, reason? }`. `valid` is true only when the
  event is kind `30078` with exactly one non-empty `d` tag, `id`/`pubkey`/`sig` are lowercase
  hex, the id and schnorr signature check out, the content passes `validateBusinessManifest`,
  and `identity.nostr.npub` is the npub of the signing key.
  Content with duplicate keys or a `__proto__` key is rejected; use the returned `manifest`
  rather than re-parsing `event.content`.
- `manifestDTag(manifest)` → the default `d` tag: the page's full hostname, lowercased, without
  port or trailing dot, with one leading `www.` removed (`https://www.Acme.com` → `acme.com`,
  `https://joes.example.com` → `joes.example.com`). A URL that would need repairing (surrounding
  or inner whitespace, a backslash, `https:acme.com` without `//`) is not used. Without a usable
  http(s) page it falls back to a slug of the name, which always starts with `_` (so it never
  equals a hostname tag): `_joe-s-plumbing` for ASCII names, and for names with non-ASCII
  characters the ASCII part plus a 16-hex sha256 suffix (`Café` → `_cafe_<16 hex>`), at most 65
  chars. See SPEC for the exact rule.
- `legacyManifestDTag(manifest)` → the `d` tag 0.1.x used (the first DNS label, e.g. `www`).
  Use it to find events published with 0.1.x, or pass it as `dTag` to keep replacing one.
- JSON Schema for external validators: `schema/bpub-business-0.1.json`
  (`import schema from 'nostr-business-manifest/schema' with { type: 'json' }`).

## Browsers, Workers, `<script>`

Bundlers (Vite, webpack, esbuild) and Cloudflare Workers resolve the package to its ESM build,
so `import { verifyManifest } from 'nostr-business-manifest'` works the same everywhere.
For a plain `<script>` tag there is a minified bundle on unpkg/jsdelivr
(`dist/browser/nostr-business-manifest.min.js`) that defines the global
`NostrBusinessManifest` (the old name `NostrBpubUtilities` still works).

## The shape (abridged)

```jsonc
{
  "schema": "bpub-business/0.1", "llm_friendly": true,
  "identity": { "name", "category", "geo", "page", "nostr": { "npub", "nip05" } },
  "channels": {
    "book":    { "via": "voice|web|mcp", "endpoint": "…" },
    "pay":     { "via": "web|onchain",   "endpoint": "…" },
    "support": { "via": "email",         "endpoint": "…" },
    "ask":     { "via": "web|mcp",       "endpoint": "…" }
  }
}
```

## The key boundary

`signManifest` is the only function that touches a private key. It runs enclave/client-side
only and outputs only public, signed material — the `nsec` is never stored, logged,
transmitted, or returned. Everything else is pure data and safe on a server.

## License

Two parts, licensed separately (see [`LICENSE`](./LICENSE)):

- **The schema / format** (`schema/bpub-business-0.1.json` and the manifest structure it
  defines) — **CC BY 4.0**. Use, share, and adapt freely with attribution.
- **The software / generation methods** — fair-code: free for organizations with less
  than **USD $1M** annual gross revenue; organizations at or above $1M may use it provided
  they credit **Humanjava Enterprises Inc.** and reference this repository
  (`nostr-business-manifest`) as the source of the methods.
