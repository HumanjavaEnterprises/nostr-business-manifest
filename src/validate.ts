/**
 * A zero-dependency validator for `bpub-business/0.1`.
 *
 * Not a general JSON-Schema engine: it hard-codes the rules of
 * `schema/bpub-business-0.1.json` (kept in agreement by an ajv test), so it stays
 * small and bundle-friendly. Emitters run it before serving, and `verifyManifest`
 * runs it on every signed manifest.
 *
 * @packageDocumentation
 */

import { BPUB_BUSINESS, VERSION, CHANNEL_VIA } from './schema.js';
import type { ValidationResult } from './types.js';

type Rec = Record<string, unknown>;

/** A JSON object: non-null, not an array (JSON Schema `"type": "object"`). */
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const isObjOrNull = (v: unknown): boolean => v === null || isObj(v);
const isStrArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNonEmptyStr = (v: unknown): boolean => typeof v === 'string' && v.length > 0;

const AGENT_POLICIES = ['read-only', 'read-and-transact'];

/**
 * Check the optional properties of `obj` against per-key predicates: a key that is
 * present (not `undefined`) must satisfy its predicate.
 */
function optional(
  errors: string[],
  obj: Rec,
  path: string,
  rules: Record<string, [(v: unknown) => boolean, string]>,
): void {
  for (const [key, [ok, what]] of Object.entries(rules)) {
    if (obj[key] !== undefined && !ok(obj[key])) errors.push(`${path}.${key} must be ${what}`);
  }
}

/**
 * Validate a manifest against `bpub-business/0.1`.
 *
 * Field by field this enforces the same rules as `schema/bpub-business-0.1.json`
 * (pinned by a test that runs the same cases through ajv): required fields, JSON
 * types (an "object" is never an array or null), the `via` and `agents.policy` enums,
 * and non-empty strings for `identity.name`, every channel `endpoint`, and
 * `resilience.canonical`. Unknown extra properties are allowed, as in the schema.
 *
 * @param m - the manifest to check
 * @returns `{ valid, errors }` — `errors` is empty when valid
 */
export function validateBusinessManifest(m: unknown): ValidationResult {
  if (!isObj(m)) return { valid: false, errors: ['manifest is not an object'] };
  const errors: string[] = [];
  const man = m;

  if (man.schema !== BPUB_BUSINESS) errors.push(`schema must be "${BPUB_BUSINESS}"`);
  if (man.llm_friendly !== true) errors.push('llm_friendly must be true');

  // meta
  if (man.meta === undefined || man.meta === null) errors.push('meta is required');
  else if (!isObj(man.meta)) errors.push('meta must be an object');
  else {
    if (man.meta.version !== VERSION) errors.push(`meta.version must be "${VERSION}"`);
    optional(errors, man.meta, 'meta', {
      lang: [(v) => typeof v === 'string', 'a string'],
      languages: [isStrArray, 'an array of strings'],
      updated: [isStrOrNull, 'a string or null'],
      generated_by: [(v) => typeof v === 'string', 'a string'],
      forkable: [(v) => typeof v === 'boolean', 'a boolean'],
      license: [(v) => typeof v === 'string', 'a string'],
      attribution: [(v) => typeof v === 'string', 'a string'],
    });
  }

  // identity
  if (man.identity === undefined || man.identity === null) errors.push('identity is required');
  else if (!isObj(man.identity)) errors.push('identity must be an object');
  else {
    const id = man.identity;
    if (id.name === undefined || id.name === '') errors.push('identity.name is required');
    else if (typeof id.name !== 'string') errors.push('identity.name must be a string');
    optional(errors, id, 'identity', {
      biz_id: [isStrOrNull, 'a string or null'],
      tagline: [isStrOrNull, 'a string or null'],
      description: [isStrOrNull, 'a string or null'],
      category: [isStrOrNull, 'a string or null'],
      geo: [isStrOrNull, 'a string or null'],
      verified: [(v) => typeof v === 'boolean', 'a boolean'],
      page: [isStrOrNull, 'a string or null'],
      nostr: [isObjOrNull, 'an object or null'],
    });
    if (isObj(id.nostr)) {
      optional(errors, id.nostr, 'identity.nostr', {
        npub: [isStrOrNull, 'a string or null'],
        nip05: [isStrOrNull, 'a string or null'],
      });
    }
  }

  // branding
  if (man.branding !== undefined) {
    if (!isObjOrNull(man.branding)) errors.push('branding must be an object or null');
    else if (isObj(man.branding)) {
      optional(errors, man.branding, 'branding', {
        icon: [isObjOrNull, 'an object or null'],
        logo: [isStrOrNull, 'a string or null'],
        colors: [isObjOrNull, 'an object or null'],
      });
    }
  }

  // channels
  if (man.channels === undefined || man.channels === null) errors.push('channels is required');
  else if (!isObj(man.channels)) errors.push('channels must be an object');
  else {
    for (const [k, v] of Object.entries(man.channels)) {
      if (v === null) continue; // a null core channel is allowed (absent)
      if (!isObj(v)) {
        errors.push(`channels.${k} must be an object or null`);
        continue;
      }
      if (!CHANNEL_VIA.includes(v.via as string))
        errors.push(`channels.${k}.via must be one of ${CHANNEL_VIA.join('|')}`);
      if (v.endpoint === undefined || v.endpoint === '') errors.push(`channels.${k}.endpoint is required`);
      else if (typeof v.endpoint !== 'string') errors.push(`channels.${k}.endpoint must be a string`);
      optional(errors, v, `channels.${k}`, {
        languages: [isStrArray, 'an array of strings'],
        auto_answerable: [(x) => typeof x === 'boolean', 'a boolean'],
        sla: [isObj, 'an object'],
        consent: [isObj, 'an object'],
      });
    }
  }

  // hours
  if (man.hours !== undefined && man.hours !== null && !Array.isArray(man.hours))
    errors.push('hours must be an array or null');

  // agents
  if (man.agents !== undefined) {
    if (!isObj(man.agents)) errors.push('agents must be an object');
    else {
      if (man.agents.policy !== undefined && !AGENT_POLICIES.includes(man.agents.policy as string))
        errors.push(`agents.policy must be one of ${AGENT_POLICIES.join('|')}`);
      if (man.agents.transact_via !== undefined && typeof man.agents.transact_via !== 'string')
        errors.push('agents.transact_via must be a string');
    }
  }

  // resilience
  if (!isObj(man.resilience) || !isNonEmptyStr(man.resilience.canonical)) {
    errors.push('resilience.canonical is required');
  }
  if (isObj(man.resilience)) {
    optional(errors, man.resilience, 'resilience', {
      registry: [(v) => typeof v === 'string', 'a string'],
      triangulation: [isObj, 'an object'],
    });
  } else if (man.resilience !== undefined && man.resilience !== null) {
    errors.push('resilience must be an object');
  }

  return { valid: errors.length === 0, errors };
}
