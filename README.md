# Rive for Foundry

Embed interactive [Rive](https://rive.app) (`.riv`) animations in Foundry VTT. Targets Foundry v12 first.

## Install

In Foundry's setup screen, open **Add-on Modules → Install Module** and paste the manifest URL for your Foundry version:

| Foundry | Manifest URL |
| --- | --- |
| v12 | `https://github.com/nathan-rive/foundary-rive/releases/download/channel-v12/module.json` |

Each channel only ever offers releases built for that Foundry version, so Foundry's update check stays on the right line.

## Rive journal pages

Add a page to a journal and choose the **Rive** page type. In the page's edit view you can:

- upload a `.riv` file from your computer (GMs, or anyone with the file-upload permission), or pick an uploaded `.riv.json` file, or paste a URL to a `.riv` file
- pick the artboard and state machine from the ones the file contains
- set the fit, alignment, aspect ratio, autoplay, and caption

Players see the animation playing inside the journal. With the aspect ratio set to `auto` (the default), the player takes the artboard's own proportions.

## Inline embeds

Write `@Rive[...]` anywhere Foundry enriches text: journal text pages, chat messages, item descriptions.

```
@Rive[rive/my-world/door.riv.json]
@Rive[https://example.com/door.riv]{sm="State Machine 1" fit=cover ratio=1 caption="The door"}
```

| Option | Meaning |
| --- | --- |
| `artboard` | Artboard name (default: the file's default) |
| `sm` | State machine name (default: the artboard's first) |
| `fit` | `contain`, `cover`, `fill`, `fitWidth`, `fitHeight`, `scaleDown`, `none`, `layout` |
| `align` | `center`, `top-left`, `top-center`, … `bottom-right` |
| `ratio` | `auto` (default) or width / height, e.g. `16/9` |
| `autoplay` | `false` to start paused |
| `caption` | Text under the player |

Quote values that contain spaces.

## Rive on scene tiles

Open a tile's configuration and use the **Rive** tab to choose a Rive file, artboard, state machine and fit. The tile's own image stays underneath as a fallback; a tile with no image gets a transparent one so Foundry still draws it. Below the file settings you can set default values for the file's inputs and view model properties, and bind properties to Foundry data (drop a document on the UUID field, then give a data path such as `system.attributes.hp.value`).

**Layout fit:** the other fits scale the artboard into the tile, so a bigger tile shows the same picture bigger (or stretched). **Layout (resize the artboard)** instead makes the artboard the tile's size in scene units (a token's: its size in grid squares times the grid size), as when you resize the artboard in the Rive editor. A file laid out for its size, with Rive layouts or a script that fills the artboard, then keeps its elements the same size on the scene and fits more of them as the tile grows; zooming in only makes it sharper. On journal pages and inline embeds (`fit=layout`) the artboard takes the size of its box in screen pixels; with the aspect ratio on **auto**, the box keeps the artboard's designed proportions.

As GM, the tile's HUD has a Rive button that opens live controls: changes play on the tile for everyone viewing the scene, and **Save current values as defaults** stores them on the tile.

## Rive on tokens

Tokens work the same way: the token configuration (for a placed token, or an actor's prototype token) has a **Rive** tab, and the token HUD has the GM's live controls. A binding can use **@actor** instead of a UUID to mean the token's own actor, linked or unlinked, so a prototype token can bind, for example, `@actor` + `system.attributes.hp.value` and every token placed from it follows its own actor. Tokens with a dynamic token ring don't show Rive yet; turn the ring off to use Rive on that token.

### Binding to conditions and token data

A binding's path can be a data path or a condition:

| Document | Path | Value |
| --- | --- | --- |
| `@actor`, or an actor/token UUID | `system.attributes.hp.value` (any data path) | That field's value |
| `@actor`, `@token`, or an actor/token UUID | `status:prone` (any status id the world defines) | `true` while the condition applies, else `false`, for a boolean property |
| `@token` | `hidden`, `elevation`, `disposition` (any token field) | That token field's value |

The path field suggests a `status:` entry for each condition. Bindings follow condition changes (Active Effects added, changed or removed, including ones from items) as well as actor and token updates, and an unlinked token follows its base actor where it doesn't override it.

### Common bindings

Bind each value to a Rive view model property of the matching type: **number** for counts and scores, **boolean** for `status:` paths and yes/no fields, **string** for text. Paths are case-sensitive.

A **color** property accepts text too: a CSS color name (`blue`, `goldenrod`, `Light Blue`, `dark-red` — case, spaces and hyphens don't matter), `transparent`, or hex (`#3a7bd5`, `#fff`, `#ff000080`). So binding a character's bio eye or hair color works as long as it's written as a color name or hex; other words (such as "auburn") are ignored and the color stays as it was. An **enum** property only takes text that exactly matches one of its options.

**Any system: the token itself (document `@token`)**

| Path | Type | What it is |
| --- | --- | --- |
| `name` | string | The token's name |
| `hidden` | boolean | Hidden from players by the GM |
| `elevation` | number | Elevation, in the scene's distance units |
| `disposition` | number | −2 secret, −1 hostile, 0 neutral, 1 friendly |
| `rotation` | number | Facing, in degrees |
| `alpha` | number | Opacity, 0 to 1 |
| `width`, `height` | number | Size in grid squares |
| `actorLink` | boolean | Linked to its actor (one shared character) or unlinked (a copy per token) |

**Any system using Foundry's built-in conditions (document `@actor`), e.g. Simple Worldbuilding**

`status:dead`, `status:unconscious`, `status:sleep`, `status:stun`, `status:prone`, `status:restrain`, `status:paralysis`, `status:fly`, `status:blind`, `status:deaf`, `status:silence`, `status:fear`, `status:burning`, `status:frozen`, `status:shock`, `status:corrode`, `status:bleeding`, `status:disease`, `status:poison`, `status:curse`, `status:regen`, `status:degen`, `status:hover`, `status:burrow`, `status:upgrade` (Empowered), `status:downgrade` (Weakened), `status:invisible`, `status:target`, `status:eye` (Marked), `status:bless`, `status:fireShield`, `status:coldShield`, `status:magicShield`, `status:holyShield`. Each is `true` while the condition is on the token.

**D&D 5e (dnd5e 4.x, document `@actor`)**

| Path | Type | What it is |
| --- | --- | --- |
| `system.attributes.hp.value` | number | Current hit points |
| `system.attributes.hp.max` | number | Maximum hit points |
| `system.attributes.hp.temp` | number | Temporary hit points |
| `system.attributes.ac.value` | number | Armor Class |
| `system.attributes.death.success` | number | Death save successes (0–3) |
| `system.attributes.death.failure` | number | Death save failures (0–3) |
| `system.attributes.exhaustion` | number | Exhaustion level (0–6) |
| `system.attributes.inspiration` | boolean | Has Heroic Inspiration (characters) |
| `system.attributes.movement.walk` | number | Walking speed |
| `system.attributes.spell.dc` | number | Spell save DC |
| `system.abilities.str.value` | number | Strength score (also `dex`, `con`, `int`, `wis`, `cha`) |
| `system.abilities.str.mod` | number | Strength modifier (same abilities) |
| `system.details.level` | number | Character level (characters) |
| `system.details.cr` | number | Challenge rating (NPCs) |
| `system.resources.primary.value` | number | First tracked resource (also `secondary`, `tertiary`) |
| `system.spells.spell1.value` | number | Remaining 1st-level spell slots (`spell2` … `spell9`) |
| `system.currency.gp` | number | Gold pieces (also `cp`, `sp`, `ep`, `pp`) |
| `system.details.eyes` | string (or color) | Eyes, from the character's bio |
| `system.details.hair` | string (or color) | Hair, from the bio |
| `system.details.skin` | string (or color) | Skin, from the bio |
| `system.details.gender`, `system.details.age`, `system.details.height`, `system.details.weight`, `system.details.faith` | string | Other bio details |
| `system.details.appearance`, `system.details.trait` | string | Appearance and personality text |

Conditions (`status:<id>`, boolean): `blinded`, `charmed`, `deafened`, `exhaustion`, `frightened`, `grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `prone`, `restrained`, `stunned`, `unconscious`, plus `bleeding`, `burning`, `cursed`, `diseased`, `silenced`, `surprised`, `transformed`. Other dnd5e states are also statuses: `dead`, `concentrating`, `dodging`, `hiding`, `flying`, `hovering`, `burrowing`, `ethereal`, `sleeping`, `stable`, `marked`, and cover (`coverHalf`, `coverThreeQuarters`, `coverTotal`).

**Simple Worldbuilding (document `@actor`)**

| Path | Type | What it is |
| --- | --- | --- |
| `system.health.value`, `system.health.max` | number | Health |
| `system.power.value`, `system.power.max` | number | Power |
| `system.attributes.<key>.value` | varies | Any custom attribute you defined |

Other systems keep their data under `system.*` with their own names; open an actor's data in the browser console (`game.actors.getName("Name").system`) to find a path.

Values that a system calculates from owned items (in dnd5e, for example AC from equipped armor, or level from class items) refresh when the actor or one of its effects next changes, not at the moment an item is equipped.

Two client settings help on slower machines: **Rive tile frame rate** (full, 30 or 15 fps) and **Maximum Rive players**.

## Monk's Active Tile Triggers

With [Monk's Active Tile Triggers](https://foundryvtt.com/packages/monks-active-tiles) (12.02 for Foundry v12) active, tile actions get a **Rive** group, so world events can drive Rive tiles and tokens: a token walks onto a trap tile and the trap springs, a door tile is clicked and a sign lights up, a combat round starts and a banner changes.

- **Set Rive value**: sets a view model property or state machine input on the chosen tiles or tokens (**This Tile** by default, or the triggering token, tiles within the area, the previous action's entities, or Tagger tags). The value can be text, a number, `true`/`false`, a color (hex or CSS name) or an enum option, and MATT's `{{token.name}}`-style values and `[[1d6]]` rolls work too. Tick **Remember** to also save it as that tile's or token's default, so it stays after everyone reloads; without it, the value lasts as long as a GM stays connected, like the GM live controls.
- **Fire Rive trigger**: fires a trigger property or trigger input once, for everyone viewing the scene right now.
- **Get Rive value**: reads a property or input so later actions can branch on it. The value is stored as `rive.<name>` (or the name you give in **Save as**): use it in MATT's **Check value** filter (Value Name `rive.sprung`, with Goto landing on fail) or in text as `{{value.rive.sprung}}`. Compare numbers as usual (`> 3`), text in quotes (`"Open"`), and for `true`/`false` check `true` and send `false` to the fail landing. It reads what the GM's client is drawing when the GM is on that scene (including changes the file's own state machine made); otherwise the property's bound data, live value or saved default, and nothing for a value only the file itself defines.

Names are the ones listed on the tile's or token's **Rive** tab. Actions run on the GM's client (MATT sends players' triggers to the GM), so a GM must be connected. Properties bound to data are left alone; they keep following their data.

A walk-over trap, for example: give a Rive tile a boolean property `sprung` that the file's state machine animates, then in the tile's MATT config add an **Enter** trigger with **Set Rive value** → `sprung` = `true`, **Remember** ticked. For a one-off effect, use **Fire Rive trigger** on a trigger property instead.

To spring a trap only once, give the tile these actions in order: **Get Rive value** `sprung`; **Check value** with Value Name `rive.sprung`, value `true` and Goto landing on fail `arm`; a **Landing** named `arm` (with Stop when reached in code ticked, the default); then **Set Rive value** and **Fire Rive trigger**. While the trap is unsprung the check fails and jumps past the landing to spring it; once sprung, the check passes and the flow stops at the landing.

## Known limitations

- **Live sync shares values, not animation history.** Journal pages and tiles sync the *current* values of inputs and view model properties. A Rive state machine can also react to the *order* values changed in (for example a transition that fires whenever a number changes). A client that joins later only receives the final values, so with that kind of logic its animation can settle in a different state from the GM's. Every client applies starting values the same way (one per frame, in the file's own order: bound data for bound properties, else live value, else stored default), so clients that load fresh agree with each other; a GM who watched a series of live edits may still differ. For files driven by synced values, make the visuals depend on the current values (for example transitions with `bool == true` / `bool == false` conditions) and keep triggers and change-fired transitions for momentary effects.
- **Rive runtime 2.44.2: feather direction changes aren't redrawn until the shape's geometry changes.** When a data-bound value switches a fill's feathering between inner and outer, the shape keeps rendering the old way (or not at all) until something changes its geometry, such as a corner radius. This happens with both the Canvas2D and WebGL2 web runtimes; the Rive editor is unaffected. Because it depends on what changed last, it can also make two clients with identical values look different. Workaround in the file: change the shape's geometry (even by a tiny amount) whenever the feather direction changes.
- **Rive scripts must be signed.** Rive's web runtimes only run scripts in files exported or published signed from Rive (in the editor, or `rive --publish` with the Rive CLI; this needs a Rive account, and a clean file without a watermark needs a Cadet plan or higher). A local `rive --once` build is unsigned, and its scripts are refused: anything they draw or drive doesn't happen, so a file whose visuals are all scripted shows nothing. Rive for Foundry tells you when that happens: on the page's or the Rive tab's status line, with a one-time notification for GMs on scene tiles and tokens, in the browser console, and in `api.healthCheck()`.
- **Foundry v12 only for now.** The release channel above is for v12; newer Foundry versions are planned through the same codebase.
- **If you disable the module:** Rive settings on tiles and tokens simply go unused and each keeps its own image, except a Rive tile that had no image of its own, which shows nothing (its image is a transparent placeholder). Rive journal pages are unavailable until the module is enabled again; their data isn't touched. Rive actions in Monk's Active Tile Triggers stay in the tile's action list and are skipped until the module is back.

## What Rive for Foundry changes in your world

Rive for Foundry only writes its own data, and only when you use it:

| What | When |
| --- | --- |
| Journal pages of the **Rive** type (their settings, defaults and bindings) | When you create or edit a Rive page, or a GM saves live values as defaults |
| `flags.foundry-rive` on tiles and tokens (Rive file, artboard, state machine, fit, defaults, bindings) | When you edit a tile's or token's **Rive** tab, a GM saves live values as defaults, or a Monk's Active Tile Triggers **Set Rive value** action with **Remember** runs |
| `prototypeToken.flags.foundry-rive` on actors | When you edit the **Rive** tab of an actor's prototype token |
| A tile's image, set to a transparent placeholder | Only for a Rive tile that has no image of its own (Foundry needs an image to draw a tile) |
| Uploaded `.riv.json` files in `rive/<world-id>/` in your user data folder | When someone with upload permission uses an upload button |
| Client settings (frame rate, maximum players) | When you change them in Configure Settings |

It never deletes documents or files, never changes permissions, and never edits documents that aren't Rive pages, tiles or tokens. Live GM controls are sent over the module's socket and change only what each client is drawing; nothing is saved unless a GM clicks **Save current values as defaults** (or a tile action has **Remember** ticked).

## Developer tools

- `game.modules.get("foundry-rive").api.openTestDialog()` plays a sample `.riv` in a dialog.
- `await game.modules.get("foundry-rive").api.spikes.all()` runs the WASM, upload, leak and scene-context checks.
- `await game.modules.get("foundry-rive").api.healthCheck()` (GM, in a scene with Rive tiles and tokens) redraws the canvas twice and checks that tiles and tokens can still be clicked and selected, every Rive object is playing, config sheets show the Rive tab, and nothing logged an error. It changes nothing in the world. If tiles ever stop responding to clicks, run it and include its report with the bug.

## Rive files and uploads

Foundry's server refuses `.riv` uploads by extension. The module uploads `.riv` files wrapped as `<name>.riv.json`:

```json
{ "format": "rive", "version": 1, "name": "door.riv", "data": "<base64 .riv bytes>" }
```

Use `await game.modules.get("foundry-rive").api.wrapper.uploadRiv(file)` to wrap and upload a `.riv` file. It returns the uploaded path. Players accept either a plain `.riv` URL or a `.riv.json` path as `src`.

## Releasing

Publish a GitHub release tagged `vX.Y.Z`. The release workflow vendors the pinned `@rive-app/canvas` runtime into `lib/`, stamps the version into `module.json`, and attaches `module.json` and `module.zip` to the release. A normal release also replaces the assets on the rolling `channel-v12` pre-release, which is what servers install and update from. Pre-releases (spikes, test builds) get a manifest pointing at their own tag and leave the channel alone; install one from its own `releases/download/<tag>/module.json`.
