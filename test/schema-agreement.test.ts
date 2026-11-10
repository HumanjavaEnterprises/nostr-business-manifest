/**
 * validateBusinessManifest and schema/bpub-business-0.1.json must agree, case by case.
 * Every case below runs through BOTH ajv (draft-07) and the zero-dependency validator.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { buildBusinessManifest, bindEntity, validateBusinessManifest, npubOf } from '../src/index.js';

const schema = JSON.parse(readFileSync(new URL('../schema/bpub-business-0.1.json', import.meta.url), 'utf8'));
const ajvValidate = new Ajv({ strict: false }).compile(schema);

const npub = npubOf('dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659');
const good = bindEntity(
  buildBusinessManifest({
    slug: 'joes',
    name: 'Joe’s Plumbing',
    hostBase: 'example.com',
    links: [
      { kind: 'website', url: 'https://joes.example.com' },
      { kind: 'pay', url: 'mailto:pay@joes.example.com' },
    ],
  }),
  { npub, payAddress: 'bc1qexampleaddr', payAsset: 'BTC' },
);

/** Clone `good` and set (or, with `undefined`, delete) the value at a dotted path. */
function mut(path: string, value: unknown): unknown {
  const m = structuredClone(good) as Record<string, any>;
  const keys = path.split('.');
  let o = m;
  for (const k of keys.slice(0, -1)) o = o[k];
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
  return m;
}

const CASES: Array<[string, unknown]> = [
  ['the good manifest', good],
  ['not an object: array', []],
  ['not an object: null', null],
  ['not an object: string', 'x'],
  ['schema wrong', mut('schema', 'bpub-business/9.9')],
  ['llm_friendly "true"', mut('llm_friendly', 'true')],
  ['meta missing', mut('meta', undefined)],
  ['meta array', mut('meta', [])],
  ['meta.version wrong', mut('meta.version', '0.2')],
  ['meta.languages not strings', mut('meta.languages', [1])],
  ['meta.updated number', mut('meta.updated', 5)],
  ['meta.forkable "yes"', mut('meta.forkable', 'yes')],
  ['identity missing', mut('identity', undefined)],
  ['identity array', mut('identity', [])],
  ['identity.name 42', mut('identity.name', 42)],
  ['identity.name object', mut('identity.name', { en: 'x' })],
  ['identity.name empty', mut('identity.name', '')],
  ['identity.name missing', mut('identity.name', undefined)],
  ['identity.page 7', mut('identity.page', 7)],
  ['identity.page null', mut('identity.page', null)],
  ['identity.verified "yes"', mut('identity.verified', 'yes')],
  ['identity.category number', mut('identity.category', 3)],
  ['identity.nostr null', mut('identity.nostr', null)],
  ['identity.nostr array', mut('identity.nostr', [])],
  ['identity.nostr.nip05 5', mut('identity.nostr.nip05', 5)],
  ['identity.nostr.npub number', mut('identity.nostr.npub', 1)],
  ['branding string', mut('branding', 'blue')],
  ['branding.logo number', mut('branding', { logo: 1 })],
  ['branding.icon string', mut('branding', { icon: 'x' })],
  ['channels missing', mut('channels', undefined)],
  ['channels array', mut('channels', [])],
  ['channels empty object', mut('channels', {})],
  ['channel string', mut('channels.ask', 'https://x')],
  ['channel array', mut('channels.ask', [])],
  ['channel null', mut('channels.ask', null)],
  ['channel via bogus', mut('channels.ask', { via: 'pigeon', endpoint: 'x' })],
  ['channel via onchain', mut('channels.ask', { via: 'onchain', endpoint: 'bc1q' })],
  ['channel via missing', mut('channels.ask', { endpoint: 'x' })],
  ['channel endpoint 5', mut('channels.ask', { via: 'web', endpoint: 5 })],
  ['channel endpoint object', mut('channels.ask', { via: 'web', endpoint: { href: 'x' } })],
  ['channel endpoint empty', mut('channels.ask', { via: 'web', endpoint: '' })],
  ['channel endpoint missing', mut('channels.ask', { via: 'web' })],
  ['channel languages bad', mut('channels.ask', { via: 'web', endpoint: 'x', languages: 'en' })],
  ['channel auto_answerable "no"', mut('channels.ask', { via: 'web', endpoint: 'x', auto_answerable: 'no' })],
  ['channel sla array', mut('channels.ask', { via: 'web', endpoint: 'x', sla: [] })],
  ['channel extra field', mut('channels.ask', { via: 'web', endpoint: 'x', note: 'hi' })],
  ['hours "always"', mut('hours', 'always')],
  ['hours array', mut('hours', [{ day: 'mon' }])],
  ['agents.policy "root"', mut('agents.policy', 'root')],
  ['agents.policy read-only', mut('agents.policy', 'read-only')],
  ['agents array', mut('agents', [])],
  ['agents.transact_via number', mut('agents.transact_via', 1)],
  ['resilience missing', mut('resilience', undefined)],
  ['resilience array', mut('resilience', [])],
  ['canonical null', mut('resilience.canonical', null)],
  ['canonical empty', mut('resilience.canonical', '')],
  ['canonical {x:1}', mut('resilience.canonical', { x: 1 })],
  ['canonical missing', mut('resilience.canonical', undefined)],
  ['registry number', mut('resilience.registry', 1)],
  ['triangulation string', mut('resilience.triangulation', 'x')],
  ['unknown top-level field', mut('extra', { anything: true })],
  ['page-less builder output', buildBusinessManifest({ name: 'No Page' })],
  ['builder with hostBase', buildBusinessManifest({ slug: 'a', name: 'A', hostBase: 'example.com' })],
];

describe('validator ⇔ JSON schema agreement', () => {
  it.each(CASES)('%s', (_label, m) => {
    const schemaOk = ajvValidate(m) as boolean;
    const ours = validateBusinessManifest(m);
    expect(ours.valid, JSON.stringify({ ajv: ajvValidate.errors, ours: ours.errors })).toBe(schemaOk);
  });

  it('the table exercises both outcomes', () => {
    const results = CASES.map(([, m]) => ajvValidate(m));
    expect(results.filter(Boolean).length).toBeGreaterThan(5);
    expect(results.filter((r) => !r).length).toBeGreaterThan(30);
  });
});
