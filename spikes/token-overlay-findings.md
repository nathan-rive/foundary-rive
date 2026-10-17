# Spike: Rive overlays on image tokens

Branch `spike/token-overlay`, test build `v0.8.8-spike.1` (delete both after the decision). Tested on the v12 server, 2026-10-17.

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

## To turn it into a feature

1. **Rive tab:** a "Draw" choice with three values: *Replace the image* (today), *Over the image, as an indicator* (A), and *Over the image, in the scene* (B). Plus an *Overlay size* field (1.0–2.0) shown for the overlay choices.
2. **Fix the gaps above:** player-account visibility, drag previews (draw the overlay on the preview too), roofs, and a test with 20+ tokens.
3. **Client safety:** A adds our sprite to Foundry's own token container. That's an addition, not a rearrangement, but it should be listed in the Client-safety checklist next to the texture swap. Tests for overlay creation and clean-up.
4. **Health check:** an overlay token's ring exists, follows its token, and is cleaned up after a redraw.
5. **Then the real condition ring sample:** core condition ids, HP ring, designed for the A mode.
