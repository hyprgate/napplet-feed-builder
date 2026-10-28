<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `feed-builder` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Feed Manager

A sandboxed NIP-5D app for authoring saved Nostr filters and feeds. Its source is
tracked in this workspace at `napplets/feed-builder`; the standalone
`hyprgate/napplet-feed-builder` repository is a generated read-only mirror.

Saving kind-39823 records and publishing kind-5 deletion requests use
`@napplet/sdk`'s `outbox.publish`. The shell owns signing and NIP-65 write-relay
selection. Relay pins entered in the feed editor are encoded into the saved
`nfeed` content; they do not override the publishing route. Save retains the
signed event returned by OUTBOX, and failed publishes leave local records intact.
The manifest requires `outbox` for these writes and `relay` for the existing
saved-record and suggestion reads.

Run from the Hyprgate workspace root:

```sh
pnpm install --frozen-lockfile
pnpm --filter ./napplets/feed-builder paja
```

Focused checks:

```sh
pnpm --filter ./napplets/feed-builder exec vitest run --maxWorkers=1
pnpm --filter ./napplets/feed-builder type-check
pnpm --filter ./napplets/feed-builder build
pnpm --filter ./napplets/feed-builder conformance
```

With `@napplet/conformance` 0.20.1 / CLI 0.3.4, the directory scan flags the
`fetch` reference in Vite 8's modulepreload helper, including in the unchanged
baseline. The single-file artifact has no external script or preload links to
invoke that helper. Boot, sandbox, envelope, and domain-absence checks pass;
manifest checks are skipped because this CLI does not resolve the generated
`.nip5a-manifest.json`. Verify the final deploy template and signed manifest
separately; do not report this conformance run as fully passing.
