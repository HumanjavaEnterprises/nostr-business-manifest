# nostr-business-manifest — a signed business manifest

An open, host-agnostic standard and toolkit for **any Nostr platform where an `npub`
represents a business entity**: build a machine-readable business manifest, bind it to a
Nostr identity and receiving keys, and sign it so anyone can verify it without trusting
the host that serves it. The standard says *what* the manifest is; the builder leaves
every *how* — which domain, which registry — to the adopting platform, which supplies its
own host (see `hostBase`). No product is privileged; nothing is estate-specific.

> Status: **DRAFT 0.1** · Schema license: **CC BY 4.0** · Composes: `nostr-agentic-identity`
> (the `npub`), `nostr-zpub-utils` (the receiving `zpub`), `@noble/curves` schnorr
> (Nostr event signing per NIP-01 / BIP-340).

## Two layers, one package

### Layer 1 — the manifest (data; safe anywhere)
`buildBusinessManifest` / `validateBusinessManifest` / `linksToChannels` produce and
check the `bpub-business/0.1` manifest: identity, branding, hours, and verb-typed
`channels` (`book / pay / support / ask`). Pure data transforms, no keys.

**Host-agnostic by design.** The builder never fabricates or hardcodes a domain. The
adopting platform supplies its own host via `hostBase` (a bare host like `"acme.example"`):
when a `slug` is given but no explicit `page`, the page is derived as
`https://${slug}.${hostBase}`, and `resilience.registry` defaults to `https://${hostBase}`.
An explicit `page`/`registry` overrides. With neither `page` nor `hostBase`, `page` is
`null` and `registry` is omitted — the library invents nothing.

### Layer 2 — the signature (makes the manifest verifiable)
- `bindEntity(manifest, { npub, payAddress?, payAsset?, payVia? })` — sets
  `identity.nostr.npub` and, when a **pre-derived receiving `payAddress`** is given,
  sets `channels.pay`. A raw extended public key (`zpub`/`xpub`) is **never** embedded —
  it exposes the whole receive-address chain — so passing `zpubBTC`/`zpubLTC` (or an
  extended key as `payAddress`) throws and writes nothing. Pure data.
- `deriveZpubAddress(zpub, asset) → Promise<address>` — a convenience that turns a
  `zpub` into a single address for `payAddress`. It loads the optional
  `nostr-zpub-utils` peer via a dynamic `import()` and only derives when the peer is
  actually installed; if it is absent it throws (it never returns the raw `zpub`). Supported
  peer range: `>=0.1.0 <0.3.0`. With nostr-zpub-utils 0.2.x a non-BIP-84 key (`xpub`, `Ltub`, …)
  is refused; that surfaces as a `BindingError` whose `cause` is the peer's `NonBip84KeyError`
  (the peer's `allowNonBip84` opt-in is never passed).
- `signManifest(manifest, nsec) → NostrEvent` — wraps the manifest in a NIP-01
  parameterized-replaceable event (`d`-tag = the page's normalised hostname, see below) and schnorr-signs it.
  **Enclave/client-only:** the `nsec` is used and discarded — never stored, logged,
  transmitted, or returned.
- `verifyManifest(event) → { valid, npub, manifest }` — requires kind `30078`, exactly one
  non-empty `d` tag, and lowercase-hex `id`/`pubkey`/`sig`; recomputes the event id,
  schnorr-verifies against `event.pubkey`, parses the manifest, checks it with
  `validateBusinessManifest`, which applies the same rules as `schema/bpub-business-0.1.json` (so a note or
  other app data that merely parses is rejected), rejects content with duplicate or `__proto__` keys, and asserts that
  `manifest.identity.nostr.npub === npubOf(event.pubkey)` (the claimed npub is compared
  against the bech32 npub of the signing key, not the raw hex pubkey). A manifest with no
  `identity.nostr.npub` (an unbound manifest) therefore fails verification — bind it
  before signing. Pure/public.

Flow: `build → bindEntity → signManifest` (in the enclave) → publish the event → anyone
`verifyManifest`s it. Verification needs no host — only the event and the signature.

## The signed event (wire format)

A signed manifest is a NIP-01 event. An interoperable implementation MUST produce and read
it as follows:

| Field | Value |
|---|---|
| `kind` | `30078` (NIP-78 app-specific, parameterized-replaceable) |
| `tags` | exactly one non-empty `d` tag: `["d", <host>]` (see *The `d` tag* below) |
| `content` | the manifest as a JSON string — **this exact byte string is what is signed** |
| `id`, `sig` | computed per NIP-01 over `[0, pubkey, created_at, kind, tags, content]`, schnorr/BIP-340 |

**Serialization is byte-exact, not structural.** The signature commits to the precise
`content` string, so `verifyManifest` recomputes the id over the event's *transmitted*
`content` bytes and re-checks the signature — it never rebuilds the manifest and re-serializes
it. Two verifiers given the same event therefore always agree. A producer that wants a second
implementation to reproduce an identical `id` for the same logical manifest must emit the same
bytes; this library emits object keys in the field order the schema lists them. Consumers that
only need to *verify* a received event do not depend on key order at all.

**The `d` tag.** By default it is the full hostname of `identity.page` (or
`resilience.canonical`): parsed as a URL, lowercased/punycoded, without port, path or trailing
dot, and with ONE leading `www.` removed when a dotted host remains — `https://www.Acme.com/x`
→ `acme.com`, `https://joes.example.com` → `joes.example.com`, `https://www.com` → `www.com`.
A URL the parser would have to repair (whitespace or control characters anywhere, a backslash, a
missing `//`, an empty label) is not used. With no usable http(s) page it is a slug of `identity.name`, which
always starts with `_` (hostnames cannot contain `_`, so it never equals a host-derived
tag). A pure-ASCII name gives `_` + its lowercase letters/digits joined by `-` (at most 64 chars,
`Joe's Plumbing` → `_joe-s-plumbing`). A name with any non-ASCII character gives `_` + the ASCII
part of its NFKD form (at most 47 chars) + `_` + the first 16 hex chars of
`sha256(UTF-8(NFKD(name).toLowerCase()))` (`Café` → `_cafe_<16 hex>`, `東京` → `__<16 hex>`), so
NFC/NFD spellings agree, distinct names stay distinct, and the tag is at most 65 chars; lone
surrogates encode as U+FFFD. A signer may override it; verifiers accept
any single non-empty value and do not re-derive it. (0.1.x used only the first DNS label, so
every `www.` page got `d="www"`; `legacyManifestDTag` reproduces that rule for finding or
replacing old events.)

**Identity binding.** `verifyManifest` additionally asserts the manifest's
`identity.nostr.npub` equals the npub of the signing key — a card cannot claim an identity it
did not sign with.

## The key boundary
Signing touches a private key, so `signManifest` runs **enclave/client-side only** and
outputs only public, signed material. Everything else (`build`, `validate`, `bind`,
`verify`) is pure data and safe on a server. The `nsec` never persists, logs, transmits,
or appears in any return value or error.

## Correctness gates (in the test suite)
- **Builder parity** — `buildBusinessManifest` output is byte-identical to the prior
  implementation over a fixture set (consumers cannot drift).
- **Sign → verify round-trip** — returns `valid: true`, the original manifest, and the
  signer's `npub`.
- **Tamper detection** — any mutation of a signed event's content or signature →
  `valid: false`.
- **Binding integrity** — an event whose `identity.nostr.npub` ≠ `event.pubkey` is
  rejected.
- **Strict verify** — a kind-1 note, a missing/duplicate `d` tag, a non-manifest content
  (e.g. bare `{identity:{nostr:{npub}}}`) or uppercase hex → `valid: false`.
- **No-leak** — no `nsec` or private byte in any return value, error, or log.
- **Schnorr correctness** — signatures verify against a known NIP-01 / BIP-340 vector.

## Conventions
Unscoped package `nostr-business-manifest` · TypeScript dual ESM/CJS + browser build · vitest ·
eslint / prettier · typedoc. Runtime deps: `@noble/hashes`, `@noble/curves`, `@scure/base`
(schnorr + bech32). `nostr-zpub-utils` is an optional peer used only by `bindEntity`.

## Non-goals
Not a relay client (it produces and verifies events; publishing them is the caller's job),
not a key manager (the seed lives in the enclave), not a re-implementation of the schema.
