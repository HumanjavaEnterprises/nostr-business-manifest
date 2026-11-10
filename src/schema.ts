/**
 * Shared constants for the `bpub-business/0.1` manifest.
 *
 * The literal values here (schema id, version, the license/attribution strings, the
 * channel vocabularies, the default registry) are part of the manifest OUTPUT
 * contract: {@link buildBusinessManifest} emits them verbatim, and existing
 * consumers pin to the exact bytes. Do not change a value here without treating
 * it as a manifest format change.
 *
 * @packageDocumentation
 */

/** The manifest schema identifier emitted in `manifest.schema`. */
export const BPUB_BUSINESS = 'bpub-business/0.1';

/** The manifest format version emitted in `manifest.meta.version`. */
export const VERSION = '0.1';

/** License string emitted in `manifest.meta.license`. */
export const LICENSE =
  'Schema: CC BY 4.0 (open). Methods: free under USD $1M annual revenue; ' +
  'at or above $1M, credit Humanjava Enterprises Inc. and the nostr-business-manifest repository.';

/** Attribution notice string emitted in `manifest.meta.attribution`. */
export const ATTRIBUTION_NOTICE =
  'The bpub-business schema is open (CC BY 4.0). The generation methods are provided by ' +
  'Humanjava Enterprises Inc.: free for organizations under USD $1M annual gross revenue; ' +
  'organizations at or above $1M attribute Humanjava Enterprises Inc. and the ' +
  'nostr-business-manifest repository. See LICENSE.';

/**
 * Verb-typed channels (the transaction surface a manifest can declare) and their
 * transports. `interac` = Interac e-Transfer (the endpoint is an email address or
 * phone number). Keep this list in sync with the `via` enum in
 * `schema/bpub-business-0.1.json` — they are two encodings of the same set.
 */
export const CHANNEL_VERBS = ['book', 'pay', 'support', 'ask', 'order', 'quote', 'website', 'menu'];

/** Allowed transports for a channel's `via` field. */
export const CHANNEL_VIA = ['web', 'email', 'sms', 'voice', 'mcp', 'api', 'interac', 'onchain'];

/**
 * The core channels every manifest declares (as `null` when absent), vs the
 * optional extras (`menu`/`order`/`quote`) that appear only when present.
 */
export const CORE_CHANNELS = ['book', 'pay', 'support', 'ask', 'website'];
