# Spike: Rive overlays on image tokens

Branch `spike/token-overlay`, test build `v0.8.8-spike.1`. Tested on the v12 server, 2026-10-17.

> **Decision (2026-10-17): out of scope for now.** Overlays and condition rings aren't part of the module at the moment. This branch is kept as a reference for later; it isn't to be merged. The condition ring sample is dropped from the samples plan.

## What was built

A token can now show its Rive file **over** its normal image instead of replacing it: `flags.foundry-rive.overlay` set to one of two modes, with `overlayScale` for how far past the token it reaches (tested at 1.3). There's no UI yet; flags were set from the console. A placeholder ring (`spikes/condition-ring-placeholder/`, RML with no scripts, 936 bytes, built unsigned with the Rive CLI) has a transparent middle, an orbiting dot, and four condition pips driven by booleans.

- **A, "interface":** a sprite inside the token's own container in the interface group, beneath its border, bars, condition icons and name.
- **B, "primary":** a second sprite in the primary group, kept in step with the token's image on every token refresh and sorted immediately after it.

## Results

| Check | A (interface) | B (primary) |
|---|---|---|
| The token keeps its own image | ✓ | ✓ |
| Ring drawn at 1.3× around a 1×1 image token | ✓ | ✓ |
| Follows the token during movement animation | ✓ 0 px apart in every sample | ✓ 0 px apart |
| Hidden token (GM view) | ✓ fades with the token (~50%) | ✓ fades with the token |
| Foundry's own dynamic token ring switched on | ✓ draws around it | ✓ draws around it |
| Draw order among tokens and tiles | Always above every token and tile (interface group) | Sorted right after its own token, so tokens and tiles above it cover it |
| **Dark scene** (darkness 1, no global light) | **Stays bright**, like Foundry's condition icons | **Darkens with the scene**, like the token's image |
| Frame rate with both overlays playing | 60 fps | 60 fps |
| Clean up when the flags are removed | ✓ nothing left behind | ✓ nothing left behind in the primary group |
| Health check afterwards | 15/15 | 15/15 |

Also confirmed: Foundry serves `.riv` files straight from a module folder (`modules/foundry-rive/assets/spike/condition-ring.riv`, status 200). So the samples can ship as plain `.riv` files with no `.riv.json` wrapper.

Not tested yet: the view from a player account (token visibility through vision), drag previews (the overlay isn't drawn on the drag ghost), roofs and occlusion (no roof tiles on the test scene), and many tokens at once.

## What it means

Image tokens and a Rive overlay work well together, so **the condition ring is worth making.** The two modes aren't rivals; they suit different art:

- **A, interface, for information:** condition rings, HP rings, markers. It stays readable in the dark and over roofs, exactly like Foundry's own condition icons and bars, which live beside it.
- **B, scene, for things that are part of the world:** auras, costumes, glow, spell effects. They're lit and sorted like the token itself, so a torch-lit aura goes dark when the lights go out.

The B mode would also make the **spell aura** possible without system code: an aura file overlaid on a token, its visibility bound to a condition (`status:<id>`).

## Structural differences and risks

Foundry v12 splits a token in two: its **image** is a mesh in the primary group (lit, darkened, sorted, hidden under roofs), and its **UI** (border, bars, condition icons, name) is a container in the interface group, drawn on top after lighting.

| | A: interface | B: primary |
|---|---|---|
| Parent | Inside Foundry's own Token container, at index 0 | Our own mesh in the shared `canvas.primary` group |
| Destroyed by | Foundry, when it clears or destroys the token | Only us |
| Following the token | Moves with the container; we set size, alpha and visibility | We copy position, alpha, visibility, elevation, sort and zIndex on every refresh |
| Lighting | None, always bright | Lit and darkened like the image |
| Draw order | Above every token image and tile, roofs included | Just after its own token's image |

Risks with **A** (some reasoned from v12 internals, not tested):

1. **A token redraw may destroy our sprite silently.** `clear()` destroys the container's children on a full redraw (new image, size). The texture survives, but nothing checked yet whether we rebuild the sprite or keep a dead pointer and lose the ring. The most likely real bug; fix by rebuilding in the draw hook when the sprite is destroyed.
2. **It draws over things the image wouldn't:** the edges of neighbouring tokens at 1.3×, and probably over roofs like Foundry's bars, which could show where a token is under a roof. Check from a player account.
3. **Something unexpected inside Foundry's object:** code reading `token.children[0]` or `token.getBounds()` sees our larger sprite. Clicks use the token's own hit area and our sprite ignores input, so clicks are fine; other modules are the unknown.

Risks with **B**:

1. **Orphans.** Foundry doesn't know our mesh exists; if clean-up fails, a ghost ring stays at the token's last position on that client until at least the next scene redraw.
2. **Coupled to sorting internals.** We copy `elevation`, `sortLayer`, `sort`, `zIndex + 1` and mark the primary group dirty on every refresh, so it re-sorts every frame while a token moves (untested at dozens of tokens). Equal `zIndex` values can flip order between frames. These fields are the most likely to change in v13.
3. **`object: placeable`.** Foundry may treat the mesh as the token's own in lookups, and it may write depth/occlusion data (hiding weather inside the ring, changing when roofs fade). Unchecked.
4. **Only follows on refresh.** Anything that changes the token's mesh directly (Sequencer, Token Magic FX filters) isn't mirrored until the next refresh.

Risks with **both**: neither copies the token's filters (invisible or detection-mode styling), rotation or mirroring; neither draws on the drag preview; both rely on v12's split layout (B on more of it). Both are display only and write nothing to documents beyond the flags.

**Verdict:** A is structurally safer (Foundry owns the parent and clean-up, no sorting internals) and suits indicators; B only for art that must be lit with the scene, after checking Foundry's source for the `object:` link, sorting and depth.

## To turn it into a feature

1. **Rive tab:** a "Draw" choice with three values: *Replace the image* (today), *Over the image, as an indicator* (A), and *Over the image, in the scene* (B). Plus an *Overlay size* field (1.0–2.0) shown for the overlay choices.
2. **Fix the gaps above:** player-account visibility, drag previews (draw the overlay on the preview too), roofs, and a test with 20+ tokens.
3. **Client safety:** A adds our sprite to Foundry's own token container. That's an addition, not a rearrangement, but it should be listed in the Client-safety checklist next to the texture swap. Tests for overlay creation and clean-up.
4. **Health check:** an overlay token's ring exists, follows its token, and is cleaned up after a redraw.
5. **Then the real condition ring sample:** core condition ids, HP ring, designed for the A mode.
