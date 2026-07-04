<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `feed-builder` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# napplet-feed-builder

[![CI](https://github.com/hyprgate/napplet-feed-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/hyprgate/napplet-feed-builder/actions/workflows/ci.yml)

Forkable source repository for the Hyprgate built-in napplet currently packaged as `@hyprgate/napp-feed-builder`.

This repository was split from `hyprgate/gui` and is mounted back into the parent checkout as `napplets/feed-builder`.
It still expects the parent workspace when built through Hyprgate because shared `@hyprgate/*` packages remain workspace dependencies.

## Parent checkout

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-feed-builder build
```

## Paja runtime

```bash
pnpm --filter @hyprgate/napp-feed-builder paja
```

This starts Kehto Paja and the napplet's Vite dev server together, using
the port configured in `vite.config.ts`.

## Testing

Run these checks from a Hyprgate parent checkout so workspace dependencies resolve:

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-feed-builder conformance
pnpm --filter @hyprgate/napp-feed-builder test
pnpm --filter @hyprgate/napp-feed-builder build
```

The `conformance` script builds the napplet and runs `@napplet/conformance-cli` against `dist/`. CI runs the same conformance, unit test, and build checks for every push and pull request.

CI runs from the standalone napplet repository but checks out `hyprgate/gui` to resolve private `workspace:*` packages. Configure `HYPRGATE_GUI_CHECKOUT_TOKEN` with read access to `hyprgate/gui` before enabling GitHub Actions.
