# Rive for Foundry

Embed interactive [Rive](https://rive.app) (`.riv`) animations in Foundry VTT. Targets Foundry v12 first.

## Install

In Foundry's setup screen, open **Add-on Modules → Install Module** and paste this manifest URL:

```
https://github.com/nathan-rive/foundary-rive/releases/latest/download/module.json
```

## Rive journal pages

Add a page to a journal and choose the **Rive** page type. In the page's edit view you can:

- upload a `.riv` file from your computer (GMs, or anyone with the file-upload permission), or pick an uploaded `.riv.json` file, or paste a URL to a `.riv` file
- pick the artboard and state machine from the ones the file contains
- set the fit, alignment, aspect ratio, autoplay, and caption

Players see the animation playing inside the journal.

## Developer tools

- `game.modules.get("foundry-rive").api.openTestDialog()` plays a sample `.riv` in a dialog.
- `await game.modules.get("foundry-rive").api.spikes.all()` runs the WASM, upload, leak and scene-context checks.

## Rive files and uploads

Foundry's server refuses `.riv` uploads by extension. The module uploads `.riv` files wrapped as `<name>.riv.json`:

```json
{ "format": "rive", "version": 1, "name": "door.riv", "data": "<base64 .riv bytes>" }
```

Use `await game.modules.get("foundry-rive").api.wrapper.uploadRiv(file)` to wrap and upload a `.riv` file. It returns the uploaded path. Players accept either a plain `.riv` URL or a `.riv.json` path as `src`.

## Releasing

Publish a GitHub release tagged `vX.Y.Z`. The release workflow vendors the pinned `@rive-app/canvas` runtime into `lib/`, stamps the version into `module.json`, and attaches `module.json` and `module.zip` to the release.
