# Rive for Foundry

Embed interactive [Rive](https://rive.app) (`.riv`) animations in Foundry VTT. Targets Foundry v12 first.

## Install

In Foundry's setup screen, open **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/nathan-rive/foundary-rive/releases/latest/download/module.json
```

## Status

Phase 0 (scaffold and spikes). This build has no journal integration yet. It provides:

- `game.modules.get("foundry-rive").api.openTestDialog()` plays a sample `.riv` in a dialog.
- `await game.modules.get("foundry-rive").api.spikes.all()` runs the WASM, upload, leak and scene-context checks.

## Releasing

Publish a GitHub release tagged `vX.Y.Z`. The release workflow vendors the pinned `@rive-app/canvas` runtime into `lib/`, stamps the version into `module.json`, and attaches `module.json` and `module.zip` to the release.
