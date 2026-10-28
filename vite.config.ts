import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    nip5aManifest({
      nappletType: 'feed-builder',
      // Phase 88 (FEED-01): feed-builder's "Open feed" invokes the NAP-INTENT
      // service (intentOpen('feed', …)); the runtime ACL gates intent.* by this
      // declared capability, so 'intent' is required or the invoke is dropped.
      requires: ['identity', 'relay', 'outbox', 'intent', 'storage'],
      optional: ['theme'],
      icon: { data: readFileSync(new URL('./icon.png', import.meta.url)), mimeType: 'image/png' },
      artifactMode: 'single-file',
    }),
  ],
  resolve: { dedupe: ['svelte'] },
  server: { port: 9515, cors: true },
  build: { outDir: 'dist' },
});
