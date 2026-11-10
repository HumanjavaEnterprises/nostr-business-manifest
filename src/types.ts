/**
 * Public types for nostr-business-manifest.
 *
 * Two groups: the manifest shapes ({@link BusinessManifest} and its parts, plus the
 * {@link BuildInput} the builder accepts) and the Nostr signing shapes
 * ({@link NostrEvent}, {@link BindOptions}, {@link VerifyResult}). No type here
 * carries a private key — the `nsec` is only ever a parameter to `signManifest`, is
 * used within the call, and is never stored on a returned value (see SPEC "The
 * boundary").
 *
 * @packageDocumentation
 */

/** A single verb-typed channel: how to reach a business for one kind of action. */
/** The allowed `via` transports (the values of `CHANNEL_VIA`). */
export type ChannelVia = 'web' | 'email' | 'sms' | 'voice' | 'mcp' | 'api' | 'interac' | 'onchain';

export interface Channel {
  /** Transport — one of {@link CHANNEL_VIA}. */
  via: string;
  /** The address for this transport (a URL, email, phone, or bare Interac handle). */
  endpoint: string;
  /** Emitters may carry extra per-channel fields (note, languages, sla, …). */
  [k: string]: unknown;
}

/** A single day's opening hours. Carried through the builder untouched. */
export interface HoursEntry {
  [k: string]: unknown;
}

/** A flat `{ kind, url }` link, the input shape {@link linksToChannels} maps. */
export interface Link {
  kind?: string;
  url?: string;
  [k: string]: unknown;
}

/** The Nostr sub-block of `identity`, present when an npub or nip05 is known. */
export interface NostrIdentity {
  npub: string | null;
  nip05: string | null;
}

/** The `identity` block of a manifest. */
export interface Identity {
  biz_id: string | null;
  name: string | null;
  tagline: string | null;
  description: string | null;
  category: string | null;
  geo: string | null;
  verified: boolean;
  page: string | null;
  nostr: NostrIdentity | null;
}

/** The `meta` block of a manifest. */
export interface Meta {
  version: string;
  lang: string;
  languages: string[];
  updated: string | null;
  generated_by: string;
  forkable: boolean;
  license: string;
  attribution: string;
}

/** The `branding` block, present when any of icon/logo/colors is supplied. */
export interface Branding {
  icon: unknown | null;
  logo: string | null;
  colors: unknown | null;
}

/** The core + optional channel set. Core keys are always present (possibly null). */
export interface Channels {
  book: Channel | null;
  pay: Channel | null;
  support: Channel | null;
  ask: Channel | null;
  website: Channel | null;
  [k: string]: Channel | null | undefined;
}

/** The `resilience` block: canonical URL, an optional registry, and triangulation. */
export interface Resilience {
  canonical: string | null;
  /** Present only when a `registry` or `hostBase` was supplied; omitted otherwise. */
  registry?: string;
  triangulation: {
    page: string | null;
    website: string | null;
    social: string | null;
  };
}

/** A complete `bpub-business/0.1` manifest, as returned by {@link buildBusinessManifest}. */
export interface BusinessManifest {
  schema: string;
  llm_friendly: boolean;
  meta: Meta;
  identity: Identity;
  branding: Branding | null;
  channels: Channels;
  hours: HoursEntry[] | null;
  agents: { policy: string; transact_via: string };
  resilience: Resilience;
}

/** The normalized record {@link buildBusinessManifest} accepts. All fields optional. */
export interface BuildInput {
  slug?: string;
  biz_id?: string | null;
  name?: string | null;
  tagline?: string | null;
  description?: string | null;
  category?: string | null;
  geo?: string | null;
  verified?: boolean;
  lang?: string;
  languages?: string[];
  updated?: string | null;
  generated_by?: string;
  logo?: string | null;
  colors?: unknown | null;
  icon?: unknown | null;
  npub?: string | null;
  nip05?: string | null;
  page?: string | null;
  /**
   * A bare host the caller owns (e.g. `"acme.example"`). When a `slug` is given but
   * no explicit `page`, the page is derived as `https://${slug}.${hostBase}`. Also
   * seeds `resilience.registry` (`https://${hostBase}`) when `registry` is absent.
   * The library never fabricates a domain — with no `hostBase` and no `page`, `page`
   * stays null and `registry` is omitted.
   */
  hostBase?: string;
  /** Explicit registry URL for `resilience.registry`. Omitted when absent and no `hostBase`. */
  registry?: string;
  links?: Link[];
  channels?: Record<string, Channel | null> | null;
  hours?: HoursEntry[] | null;
  social?: string | null;
  website?: string | null;
}

/** The result of {@link validateBusinessManifest}. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** A signed Nostr event (NIP-01), as produced by {@link signManifest}. Public material only. */
export interface NostrEvent {
  /** 32-byte event id (sha256 of the serialized event), hex. */
  id: string;
  /** 32-byte x-only public key of the signer (schnorr), hex. */
  pubkey: string;
  /** Unix timestamp (seconds). */
  created_at: number;
  /** Event kind — parameterized-replaceable ({@link MANIFEST_KIND}). */
  kind: number;
  /** Tags — exactly one `d` tag (see `manifestDTag`) for replaceability. */
  tags: string[][];
  /** The serialized manifest (JSON). */
  content: string;
  /** 64-byte schnorr (BIP340) signature, hex. */
  sig: string;
}

/** Options for {@link bindEntity}: the identity npub and an optional pay address. */
export interface BindOptions {
  /** The business's Nostr public key (bech32 `npub…`). Set on `identity.nostr.npub`. */
  npub: string;
  /**
   * RECOMMENDED — a ready-to-publish receiving ADDRESS for `channels.pay`. A single
   * address is what a public, relayed manifest should carry. An extended key passed
   * here is rejected.
   */
  payAddress?: string;
  /** Asset label for the pay channel — REQUIRED when `payAddress` is set (no default). */
  payAsset?: 'BTC' | 'LTC';
  /**
   * Transport for the pay channel when `payAddress` is set. Default `'onchain'`. Must be
   * one of `CHANNEL_VIA`; anything else throws a `BindingError`.
   */
  payVia?: ChannelVia;
  /**
   * DISCOURAGED — a raw extended public key. `bindEntity` will NOT embed this (a zpub
   * exposes the whole receive-address chain) and THROWS if it is set. Derive a single
   * address first with {@link deriveZpubAddress} and pass it as `payAddress`.
   */
  zpubBTC?: string;
  /** DISCOURAGED — see {@link BindOptions.zpubBTC}. */
  zpubLTC?: string;
}

/** The result of {@link verifyManifest}. */
export interface VerifyResult {
  /**
   * True iff the event is a well-formed kind-30078 event with one `d` tag, the id and
   * signature verify, the content passes the schema, AND the manifest npub matches the
   * event pubkey.
   */
  valid: boolean;
  /** The signer's npub (bech32), derived from `event.pubkey`, or null when invalid. */
  npub: string | null;
  /** The manifest parsed from `event.content`, or null when it cannot be parsed. */
  manifest: BusinessManifest | null;
  /** Human-readable reason when `valid` is false. */
  reason?: string;
}

/** Options for {@link signManifest}. */
export interface SignOptions {
  /** Override the event `created_at` (seconds). Defaults to now. */
  created_at?: number;
  /** Override the `d` tag. Defaults to `manifestDTag(manifest)` (the page's normalised hostname). */
  dTag?: string;
}
