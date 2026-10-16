# Rive for Foundry: instructions for Claude

Rive for Foundry (module id `foundry-rive`, repo `nathan-rive/foundary-rive`) is a Foundry VTT **v12** module that plays Rive (`.riv`) animations in journal pages, inline `@Rive[...]` embeds, scene tiles and tokens. GMs can drive Rive state live for every client, and bind Rive properties to Foundry data. It is system-agnostic. It runs inside people's campaign worlds (including the owner's own v12 campaign), so **protecting world data comes before every feature.** Read this file before changing anything.

## Before EVERY commit: run the safety audit (mandatory)

Do all four steps before every commit, with no exceptions. If any step fails, fix it or stop and tell the user. Never commit around a failure.

1. **Version:** builds are produced by the release workflow from the release tag; never hand-edit the `version`, `manifest` or `download` fields in `module.json`. Pick the tag by the rules in **Releases** below.
2. **Tests:** `npm install --no-save --no-package-lock linkedom@0.18.12` once (a test-only DOM), then `node tests/run.mjs` (Node 20+). Every check must pass. Add tests for new behaviour, and especially for anything that writes to the world. If Node isn't installed on the machine, push the branch and wait for the **Tests** workflow to pass instead; never release with it failing.
3. **Audit:** `python tools/audit.py` (`py tools/audit.py` on Windows). It lists every line that can change world data, files on the server or other clients' state (`world:` kinds), or that changes or hooks into Foundry's own canvas objects, sheets and lifecycle (`client:` kinds), and marks new or changed ones as `NEW`. It also self-tests its own patterns.
   - Review **each** `NEW` site against the matching checklist below (World-safety for `world:`, Client-safety for `client:`), reading the surrounding code rather than just the one line.
   - Only when every site passes, record the review with `python tools/audit.py --accept`, and commit `tools/audit-reviewed.txt` with the change.
   - Never run `--accept` just to make the audit pass.
4. **Report:** in your reply to the user, summarise what the audit flagged and why each new site is safe. If the set of things the module writes changed, update the README's **"What Rive for Foundry changes in your world"** section in the same commit.

## World-safety checklist

Check every write site, and the code that reaches it, against these rules:

1. **Only the module's own data.** Writes may touch only:
   - journal pages of the module's own type (`foundry-rive.rive`), and only their `system` data;
   - `flags.foundry-rive.*` on tiles, tokens, prototype tokens (through `prototypeToken.flags.foundry-rive.*` on the actor) and nothing else's flags;
   - `texture.src` of a tile that has a Rive file but no image, set to the module's own `assets/transparent.png` (in the `preCreateTile` / `preUpdateTile` hooks only), because a v12 tile without an image gets no mesh;
   - the `foundry-rive.*` settings (client scope only today);
   - uploaded files under `rive/<world-id>/` in the user data folder.

   Anything else needs the user's explicit approval first.
2. **Rive documents are found by their marker, never by name.** A Rive page is one whose `type` is `foundry-rive.rive`; a Rive tile or token is one with `flags.foundry-rive.src` (use `riveFlags()`). Never select documents to modify by name alone.
3. **Uploads go through `uploadRiv()` only,** into `rive/<world-id>/`, wrapped as `<name>.riv.json`, and only for users with the `FILES_UPLOAD` permission. Never upload anywhere else, never overwrite or delete server files, and never fetch-and-write on someone's behalf.
4. **No deleting other documents.** The module never deletes actors, items, scenes, journals, pages, tiles, tokens, tables, macros, folders, users or files. `-=` keys may only remove the module's own `flags.foundry-rive` keys.
5. **No permission changes.** Never change `ownership` or user roles on existing documents.
6. **No bulk operations.** No loops over `game.actors`, `game.journal`, `game.scenes` or a scene's tiles/tokens that write. If a migration is ever needed, it must touch only the module's own data, be guarded by a migration-version setting, and run on the active GM only.
7. **Live sync never writes documents.** Socket messages (`module.foundry-rive`) change only what clients are drawing. Handlers apply only messages that claim a GM sender, and must not call `update`/`create`/`delete` or `settings.set`. "Save current values as defaults" is a separate, explicit GM click.
8. **Use the document API only.** All writes go through `update`, `create`, `updateSource` in a `pre*` hook, `settings.set`, or `FilePicker.upload` inside `uploadRiv()`, so Foundry validates them. Reads may `fetch` the module's own files and the Rive files a user configured.
9. **Never store live documents or references in flags.** Store plain values (strings, numbers, arrays of `{name, value}` / `{name, uuid, path}`); copy data before keeping it.
10. **Hooks stay narrow.** Every `draw*`, `refresh*`, `update*`, `pre*` and render hook must return early for anything that isn't a Rive page, tile or token, and must not change behaviour for non-Rive documents.
11. **Permissions are respected.** GM-only tools (live controls, HUD buttons, saving live values as defaults) check `game.user.isGM`. Config tabs rely on Foundry's own sheet permissions. Players only update documents they own.
12. **Fail safe.** If a Rive file fails to load, a bound document is missing or a value has the wrong type, warn and show nothing; never "repair" by guessing which documents to change.
13. **Disabling the module must stay harmless.** Data stays valid without the module: flags simply go inert, and a Rive tile keeps its own image. Known exceptions are documented in the README's **Known limitations**: a Rive tile that only has the transparent fallback image draws nothing, and pages of the module's type are unavailable while it's disabled. Don't add new exceptions without the user's approval.
14. **Validate before writing.** Page `system` data goes through the `RivePageModel` schema; flag values the sheets write are plain strings/arrays built by the module, never raw user objects.

## Client-safety checklist

Foundry's canvas, sheets and hooks are shared with core and every other module. A mistake here can leave a world unusable without touching its data: in 0.8.0 a destroyed Rive texture that a tile still held made Foundry's tile-layer tear-down throw, and every tile in the scene stayed unselectable until a reload. Check every `client:` site, and the code around it, against these rules:

1. **Hand back before you destroy.** Never destroy a texture, mesh, canvas or element that a Foundry object (placeable, mesh, sheet) may still reference. Restore what Foundry had first (`restoreTextures`); if that's gone, leave an empty value Foundry's own getters accept (`null` texture, `PIXI.Texture.EMPTY` on a mesh).
2. **Code in Foundry's lifecycle must not throw into Foundry.** Code that runs in draw, refresh, destroy, tear-down and render paths handles its own errors: log, drop Rive for that object, and let Foundry carry on. An exception inside a layer's tear-down leaves that layer unclickable.
3. **Leave core state as you found it.** Don't set `renderable`, `visible`, `eventMode`, `hitArea` or similar on Foundry's objects, only on our own. The core properties we do replace (a placeable's `texture` and its mesh's `texture`) are restored on detach.
4. **Lifecycle hooks are idempotent.** Redraws, scene changes and resizes, a hook firing twice or out of order, must not leave stale bridges, players, tickers or listeners.
5. **Sheets and HUDs: add, don't rearrange.** Add only our own nav item and tab (placed by `findTabSlot`) or HUD button; never move, remove or re-render other elements. If there's no safe place, add nothing.
6. **No patches of core classes** (`prototype` assignments, libWrapper, redefined globals) without the user's approval. Approved so far, both passing every message on and restoring `console.error` only if it's still theirs: `runtime-log.mjs` tees `console.error` while the Rive runtime starts (the runtime keeps the tee, to report refused scripts), and the health check captures it for the length of a check.
7. **Page-level DOM** is only our own hidden host and datalists, created once with fixed ids.
8. **Health check before handing over.** Every test build passes the in-world health check (below) before it goes to the user, and every release before it ships.

### Health check

Run as GM on the test server, in a scene with Rive tiles and tokens and the browser pane visible: `await game.modules.get("foundry-rive").api.healthCheck()`. It writes nothing. It redraws the canvas twice, then checks that every canvas layer is still interactive, every Rive tile and token has a live player and live textures, Foundry's own tile getters work, a Rive tile and token are found by a pointer hit test and can be selected, their config sheets open with the Rive tab at top level, and no errors were logged (known Rive runtime noise excepted). Report the result to the user with the test build.

When a change touches the canvas, also try by hand: resizing the scene or changing its background, switching scenes, deleting a Rive tile, and disabling the module.

## Releases and the server

- **Channels:** servers install and update from the rolling `channel-v12` pre-release (`https://github.com/nathan-rive/foundary-rive/releases/download/channel-v12/module.json`), never `releases/latest`. A normal (non-pre-) release updates the channel; pre-releases never do.
- **Test builds** are GitHub pre-releases from a feature branch, installed from their own tag's `module.json`. Run the health check on each one before handing it to the user. Foundry compares versions part by part on `.` and treats `X.Y.Z-dev.N` as **newer** than `X.Y.Z`, and it refuses downgrades. So a test build named `X.Y.Z-dev.N` must be followed by a release strictly above `X.Y.Z`.
- **Releases and pushes are outward-facing** (the repo is public). Ask before pushing, merging or releasing unless the user has already said to for the current work.
- **The owner's server** is `https://vtt.nathanmitchell.graphics/` (Foundry v12). Claude can't sign in to its admin page (it isn't localhost): the user signs in. To update: log out → "Return to Setup" on the join page (shuts the world down) → `Setup.installPackage` with the manifest URL → launch the world → join. Right after a release the channel download can be stale for a few minutes; installing from the release's own tag manifest works and still points future updates at the channel.
- Browser tabs share one Foundry login cookie: database writes go through as whoever joined last. Rive only draws while its page is on screen, so render checks need the browser pane visible.
- Delete nothing on the server (modules, worlds, files) without the user's explicit OK; let the user click Foundry's own delete confirmations.

## Project layout

| Path | What it is |
|---|---|
| `scripts/main.mjs` | Entry point: hooks, the page type and sheet registration, settings and the public API (`game.modules.get("foundry-rive").api`). |
| `scripts/constants.mjs` | Module id, WASM path, player cap. |
| `scripts/rive-player.mjs` | `RivePlayer`: a framework-agnostic wrapper around one Rive instance (mount, suspend, destroy, cleanup sweep). |
| `scripts/riv-wrapper.mjs` | `.riv.json` wrapping and `uploadRiv()`, the only upload path. |
| `scripts/state.mjs` | Inputs and view model properties: describe, apply, bindings (`@actor`), start-up sequencing. |
| `scripts/sync.mjs` | Live GM → player sync over the module socket (versioned values, late-join requests). |
| `scripts/live-controls.mjs` | Defaults editor and GM live panel shared by pages, tiles and tokens. |
| `scripts/journal/` | The `foundry-rive.rive` page type: data model, AppV1 sheet, state editor. |
| `scripts/enricher.mjs` | Inline `@Rive[...]` embeds. |
| `scripts/stage.mjs` | Player sizing (aspect ratio). |
| `scripts/canvas/` | Tiles and tokens: the texture bridge (`rive-canvas.mjs`), the config tab (`rive-config.mjs`) and HUD button (`rive-hud.mjs`). |
| `scripts/dev/` | Developer tools: the in-world health check (`health-check.mjs`, `api.healthCheck()`). |
| `scripts/spikes.mjs` | Developer checks callable from the console. |
| `templates/`, `styles/`, `lang/`, `assets/` | Handlebars templates, CSS, localization and the transparent fallback image. |
| `.github/workflows/release.yml` | Builds `module.zip` (vendoring the pinned `@rive-app/canvas`), stamps `module.json`, updates the channel; runs the tests and audit first. |
| `.github/workflows/tests.yml` | Runs the tests and the audit on every push. |
| `tools/audit.py`, `tools/audit-reviewed.txt` | The world-safety audit and its reviewed baseline. |
| `tests/` | Node test suites. `node tests/run.mjs` runs them all (the config-sheet layout tests need linkedom; see step 2 above). |
| `riv_samples/`, `bug-reports/` | Sample `.riv` files and runtime bug write-ups; don't commit changes to them unless the user asks. |

## Conventions

- Target **Foundry v12** (AppV1 sheets, `JournalPageSheet`, render hooks with jQuery). v13/v14 support will come through version adapters in the same codebase; never break v12 to get there.
- Keep `rive-player.mjs`, `stage.mjs` and the wrapping/parsing helpers free of Foundry globals at import time, so they can be tested in Node.
- Stored input/property values are strings, coerced by the type the Rive file reports. Starting values are applied one per Rive advance, in the file's own order (`applyInitialState`).
- The Rive runtime is `@rive-app/canvas`, pinned in the release workflow (`RIVE_VERSION`). Rive only draws into canvases laid out in the page; scene sources live in a hidden host element.
- Known Rive runtime bug (2.44.2): data-bound feather direction changes aren't redrawn until geometry changes; see `bug-reports/rive-feather-redraw/`.
- `AdminPassword` in the repo root is git-ignored and must never be committed or used by Claude.
- **Commits** go on the branch the user expects (check `git branch --show-current` first) and end with the attribution lines the session asks for.
