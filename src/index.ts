/**
 * nostr-business-manifest — build, validate, sign, and verify the `bpub-business/0.1`
 * business manifest.
 *
 * Two layers:
 *
 * 1. **The manifest** (`buildBusinessManifest`, `validateBusinessManifest`,
 *    `linksToChannels`) — pure data, safe anywhere. The builder's output is
 *    byte-identical to the original implementation (pinned by the parity test).
 * 2. **The signature** (`bindEntity`, `signManifest`, `verifyManifest`) — wrap the
 *    manifest in a NIP-01 Nostr event and schnorr-sign (BIP340) it with the
 *    business's own key.
 *
 * THE ONE BOUNDARY: `signManifest` is the only function that touches a private key.
 * It is ENCLAVE/CLIENT-ONLY, uses the `nsec` then drops it, and never stores, logs,
 * or echoes it. Everything else touches PUBLIC material only. Read SPEC.md first.
 *
 * @packageDocumentation
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
  Channel,
  ChannelVia,
  Channels,
  HoursEntry,
  Link,
  NostrIdentity,
  Identity,
  Meta,
  Branding,
  Resilience,
  BusinessManifest,
  BuildInput,
  ValidationResult,
  NostrEvent,
  BindOptions,
  VerifyResult,
  SignOptions,
} from './types.js';

// ── Constants ──────────────────────────────────────────────────────────────────
export {
  BPUB_BUSINESS,
  VERSION,
  LICENSE,
  ATTRIBUTION_NOTICE,
  CHANNEL_VERBS,
  CHANNEL_VIA,
  CORE_CHANNELS,
} from './schema.js';

// ── Layer 1 — the manifest (pure data, safe anywhere) ────────────────────────────
export { buildBusinessManifest, linksToChannels } from './build.js';
export { validateBusinessManifest } from './validate.js';

// ── Layer 2 — the signature ──────────────────────────────────────────────────────
// bindEntity / verifyManifest / deriveZpubAddress are pure/public; signManifest is
// ENCLAVE/CLIENT-ONLY.
export {
  bindEntity,
  deriveZpubAddress,
  signManifest,
  verifyManifest,
  manifestDTag,
  legacyManifestDTag,
  npubOf,
  pubkeyOfNpub,
  MANIFEST_KIND,
  BindingError,
  InvalidPrivateKeyError,
  InvalidPublicKeyError,
} from './sign.js';
