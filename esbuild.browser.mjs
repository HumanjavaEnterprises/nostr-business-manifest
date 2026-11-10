import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/browser.ts'],
  bundle: true,
  minify: true,
  // A plain <script> asset (served via unpkg/jsdelivr). Bundlers and Workers use the
  // ESM build (dist/index.js) through the `exports` conditions, never this file.
  sourcemap: false,
  format: 'iife',
  globalName: 'NostrBusinessManifest',
  // Keep the pre-0.2.0 global name as an alias for existing <script> users.
  footer: { js: 'globalThis.NostrBpubUtilities=NostrBusinessManifest;' },
  outfile: 'dist/browser/nostr-business-manifest.min.js',
  target: ['es2020'],
  platform: 'browser',
  // The optional peer is resolved at runtime via dynamic import(); never bundled.
  external: ['nostr-zpub-utils'],
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
  metafile: true,
});

const output = Object.entries(result.metafile.outputs)
  .filter(([k]) => k.endsWith('.js'))
  .map(([k, v]) => `${k}: ${(v.bytes / 1024).toFixed(1)}KB`);
console.log('Browser bundle built:', output.join(', '));
