# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-11-10

Fixes from the 2026-11-10 package review.

### Breaking

- **`verifyManifest` is strict.** It now returns `valid: false` unless the event is kind `30078`, carries
  exactly one non-empty `d` tag, has 64/64/128 lowercase-hex `id`/`pubkey`/`sig`, integer `kind`/`created_at`,
  string-array `tags`, and content that passes `validateBusinessManifest` — on top of the id, signature and
  npub-binding checks it already did. Before, a kind-1 note (or any other event from the key) whose content
  parsed and contained `identity.nostr.npub` was reported `valid: true`, as was an uppercase-hex `sig`.
  Events produced by `signManifest` from a schema-valid manifest still verify. Content with a duplicate object
  key (anywhere) or a `__proto__` key is also rejected, so `result.manifest` is the only reading of the content.
  Always use `result.manifest`; do not re-parse `event.content` yourself.
  Event fields are read once as own data properties (accessor/getter properties, inherited-only fields, and
  `tags` that are not arrays of strings, are sparse, or carry a `toJSON` are rejected) and the id is computed
  from exactly those values. Objects from another realm (e.g. `node:vm`, iframes) and class instances with own
  data fields are accepted.
- **Page-less manifests no longer verify.** A manifest built without `page`/`hostBase` has
  `resilience.canonical: null`; 0.1.2 verified such events, 0.2.0 does not ("resilience.canonical is required").
  This is intended: SPEC and the schema list `resilience.canonical` as required, and 0.1.2's own
  `validateBusinessManifest` already rejected these manifests; only the verifier skipped the check.
- **`validateBusinessManifest` checks types, field by field, as the JSON schema does** (it was a truthiness
  check). Now rejected: e.g. `identity.name: 42`, an endpoint that is a number or object, `channels: []`,
  `identity.page: 7`, `resilience.canonical: {}`, `agents.policy: "root"`, `hours: "always"`,
  `identity.verified: "yes"`, `nip05: 5`. A test runs one table of cases through ajv and the validator and
  requires them to agree.
- **Schema file (`schema/bpub-business-0.1.json`, same `$id`):** `via` gains `onchain` (widening — see Fixed);
  `identity.name`, channel `endpoint` and `resilience.canonical` must be non-empty strings (`canonical` may no
  longer be `null`). Validators using the 0.1.2 copy of the schema reject pay-bound manifests, as they did before.
- **`bindEntity` `payVia` is typed `ChannelVia`** and anything outside `CHANNEL_VIA` throws a `BindingError`
  (before, `payVia: 'lightning'` produced a manifest that could not verify).
- **Optional peer range is `nostr-zpub-utils >=0.1.0 <0.3.0`.** With 0.2.x, `deriveZpubAddress` on a non-BIP-84
  key throws a `BindingError` (`cause` = the peer's `NonBip84KeyError`); the peer's `allowNonBip84` opt-in is
  never passed. `BindingError` gains an optional `cause`.
- **`signManifest` throws on an empty or non-string `dTag`** (it used to sign an event that verify rejects).
- **The default `d` tag is the full normalised hostname** of the page (or canonical) URL, with one leading
  `www.` removed: `https://www.acme.com` → `acme.com` (was `www`), `https://joes.example.com` →
  `joes.example.com` (was `joes`). 0.1.x used only the first DNS label, so two businesses signed by one key
  with `www.` pages (or `acme.com` / `acme.ca`) replaced each other on relays. Re-signing a manifest with
  0.2.0 therefore publishes a NEW addressable event; the 0.1.x event stays on relays under its old `d`.
  To find an old event, query `d = legacyManifestDTag(manifest)`. To keep replacing it in place instead,
  sign with `signManifest(m, nsec, { dTag: legacyManifestDTag(m) })`. Verifiers accept either value.
  A page URL the WHATWG parser would have to repair (leading/trailing/inner whitespace or control characters,
  a backslash, a missing `//` as in `https:acme.com`, an empty label as in `https://..com`) is not used; the
  tag then falls back to the name slug. Every name-derived tag now starts with `_`, so it can never
  equal a hostname-derived tag (`https://acme` → `acme`, name `Acme` → `_acme`; 0.1.x gave `acme` for both).
  Non-ASCII names stay distinct: `_` + the ASCII part of the NFKD form (≤47 chars) + `_` + 16 hex chars of
  sha256 of the lowercased NFKD name (`東京` → `__<16 hex>`; 0.1.x gave `business` for every non-ASCII name).
  Pure-ASCII names: `_` + the 0.1.x-style slug capped at 64 chars. At most 65 chars in all cases.
  `legacyManifestDTag` keeps the exact 0.1.x rule.
- **`browser` now resolves to the ESM build.** The `browser` export condition and top-level `browser` field
  pointed at an IIFE script with no exports, so bundlers got `undefined` for every named import. `browser`,
  `workerd` and `worker` all resolve to `dist/index.js`; the IIFE is offered only via `unpkg`/`jsdelivr`.
- **IIFE global renamed** to `NostrBusinessManifest`; `NostrBpubUtilities` is kept as an alias.

### Added

- `manifestDTag(manifest)` — the default `d` tag (see above).
- `legacyManifestDTag(manifest)` — the 0.1.x `d` tag, for finding/replacing old events.
- `ChannelVia` type — the union of allowed `via` values.

### Fixed

- `CHANNEL_VIA` and the JSON Schema now include `onchain`. `bindEntity` has always written `via: 'onchain'` for a
  pay address (and the README documented it), but the validator rejected it, so with the strict verifier every
  manifest bound with a pay address would have failed verification.
- No source maps in the tarball; CHANGELOG.md ships; `engines.node >=20`; `sideEffects: false`;
  `./package.json` exported.
- README: the peer is `nostr-zpub-utils` (not `nostr-zpub-utilities`); `deriveZpubAddress` requires `asset`.
- The esbuild `external` for the optional peer uses the current name (`nostr-zpub-utils`; committed after
  0.1.2 was published).
- Dev dependencies: vitest ^4.1.12 (Node 20 support kept) and a `minimatch` override, so `npm audit` reports 0 vulnerabilities.

## [0.1.0] - 2026-08-28

Initial release — build, validate, sign, and verify the `bpub-business/0.1` business manifest.

### Added

- **Layer 1 — the manifest (pure data, safe anywhere):**
  - `buildBusinessManifest(input)` — build a `bpub-business/0.1` manifest from a normalized record
    (identity, meta, branding, verb-typed `channels`, hours, resilience). TypeScript port of the original
    implementation; for a given input its mapping is **byte-identical** to the original (pinned by the
    parity test). **Host-agnostic:** the builder never hardcodes a domain. A new optional `hostBase` input
    (a bare host like `"acme.example"`) derives `page = https://${slug}.${hostBase}` when a `slug` but no
    explicit `page` is given, and seeds `resilience.registry = https://${hostBase}` when `registry` is
    absent. With neither `page` nor `hostBase`, `page` is `null` and `registry` is omitted — no domain is
    invented. (Intentional change from the original, which hardcoded a product host; adopters pass their own
    host, so it does not affect callers that already supply `page`/`registry`.) The default `generated_by`
    is now `"nostr-business-manifest"`.
  - `validateBusinessManifest(manifest)` — a fast, zero-dependency structural guard returning
    `{ valid, errors }`.
  - `linksToChannels(links, { pageUrl })` — map a flat `{ kind, url }` link list to verb-typed channels.
- **Layer 2 — the signature (Nostr / schnorr):**
  - `signManifest(manifest, nsec, opts?)` — wrap the manifest in a NIP-01 parameterized-replaceable Nostr
    event (`kind 30078`, `d`-tag = the business slug) and schnorr-sign (BIP340) it. **ENCLAVE/CLIENT-ONLY:**
    the `nsec` is used and dropped — never returned, logged, or echoed in an error; the scalar is zeroed after
    use. Accepts an `nsec…` bech32 or a 64-char hex key; rejects non-private-key input without echoing it.
  - `verifyManifest(event)` — recompute the event id, schnorr-verify against `event.pubkey`, parse the
    manifest, and assert the manifest's claimed `npub` equals the signing key. Pure/public.
  - `bindEntity(manifest, { npub, payAddress?, payAsset?, payVia? })` — set `identity.nostr.npub` and, when a
    pre-derived receiving `payAddress` is given, set `channels.pay`. Pure/public; returns a new manifest (the
    input is not mutated). **A raw extended public key (`zpub`/`xpub`) is never embedded** — it exposes the
    whole receive-address chain — so passing `zpubBTC`/`zpubLTC` throws a `BindingError` and writes nothing.
  - `deriveZpubAddress(zpub, asset?)` — convenience that turns a `zpub` into a single address for `payAddress`.
    Loads the optional `nostr-zpub-utilities` peer via a dynamic `import()`; derives only when the peer is
    installed, and throws (never returns the raw `zpub`) when it is absent.
  - `npubOf(hexPubkey)` / `pubkeyOfNpub(npub)` — bech32 `npub` encode / decode helpers.
- **Tests (vitest):** builder parity (byte-identical to the original over a fixture set), sign→verify
  round-trip, tamper detection, binding integrity (npub ≠ pubkey rejected), no-leak (no private key in any
  return value or error), and schnorr correctness against a known BIP340 test vector. Plus a built-artifact
  smoke test over ESM + CJS.
- Dual ESM + CommonJS build with `.d.ts` and a browser IIFE bundle. Runtime deps pinned exact to the audited
  stack: `@noble/curves` 2.3.0, `@noble/hashes` 2.3.0, `@scure/base` 2.3.0. `nostr-zpub-utilities` is an
  optional peer used only by `bindEntity`.

### Notes

- `signManifest` is the only function that touches a private key; it never stores, logs, transmits, or echoes
  it. Every other function operates on PUBLIC material only. See [SECURITY.md](SECURITY.md).
