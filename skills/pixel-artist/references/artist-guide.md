# Pixelator Artist Guide

Version: 2026-11-09.1. Apply this guide to every Pixelator creation, variant, edit and visual review. These are working defaults, not a mandate to change the requested aesthetic. Explicit user direction and the saved project/asset style take precedence; explain relevant departures in the review. A local edit must stay local even when unrelated art could be improved.

## Design for the game

Before drawing, identify the intended size, view, proportions, palette, light direction and defining features. Read the project style and inspect related sprites. Block in a recognizable silhouette and major color masses before adding details. At tiny sizes, spend pixels on the features that identify the object; an outline is optional if it consumes needed space. [Derek Yu: Basics](https://www.derekyu.com/makegames/pixelart.html)

## Shape and pixel placement

Build with connected color clusters, refining large forms into smaller ones. Clean accidental bumps and inconsistent stair steps on curves. Remove stray pixels that add noise; retain deliberate eyes, highlights and other essential single-pixel details. Cluster count is a diagnostic, not a score to minimize blindly. [Pedro Medeiros / Saint11: Cluster Sketching and Painting](https://saint11.art/pixel_art_articles/article2/)

## Palette and contrast

Reuse the saved palette and obey its lock and color budget. Give neighboring materials and important features distinct values; extra near-identical colors rarely fix weak forms. Use hue/saturation shifts in ramps when they suit the art direction. Reserve strong saturation and contrast for focal details instead of giving every area equal emphasis. Warm highlights and cool shadows are an option, not a universal law. [Saint11: Basic Color Theory](https://saint11.art/pixel_art_articles/article6/)

## Light and material

When the style uses shading, shade the represented volume from the chosen light direction. Separate planes and cast shadows where readable; use focused highlights for glossy surfaces and broader transitions for rough ones. Avoid simply tracing dark rings inside the outline (pillow shading). Flat or 1-bit art need not acquire extra shading. [Saint11: Basic Shading](https://saint11.art/pixel_art_articles/article4/)

## Edges and texture

Check for parallel color strips that merely follow contours and flatten the image (banding). Dithering must explain texture or a useful transition; remove it when it becomes distracting noise. Isolated pixels can be justified by tiny features or specular highlights. These choices require looking at the image, not automatically deleting every isolated pixel. [cure: The Pixel Art Tutorial](https://pixeljoint.com/forum/forum_posts.asp?TID=11299)

Anti-alias only where the style, palette and size benefit. Too many intermediate tones blur forms. Never bake an unknown background color into a transparent game sprite's outer edge. Keep the native raster and lossless PNG; use integer nearest-neighbor enlargement for inspection, without resampling the actual asset. [Saint11: Anti-Alias and Banding](https://saint11.art/pixel_art_articles/article5/), [Derek Yu: Basics](https://www.derekyu.com/makegames/pixelart.html)

## Animation

Plan the key poses first (start and end of the loop, contacts, the extreme of an attack), then add in-betweens; this catches timing problems before detail work. Timing comes from the number of frames and how long each is shown: hold key and impact poses longer, pass quickly through in-betweens, and avoid equal durations everywhere when the motion needs weight. Use anticipation before strong actions and follow-through after them; when squashing or stretching, keep the volume constant. Loops must connect: judge the last frame next to the first. [Saint11: A Basic Aseprite Animation](https://saint11.art/pixel_art_articles/article3/), [Twelve basic principles of animation](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation)

Keep the silhouette readable in every frame at native size, and keep proportions, palette and light consistent across frames. Anchor the sprite: the base stays on the pivot line unless the motion itself moves the body. Unintended one-pixel shifts of stable parts read as jitter, not motion. Change only what moves: reuse unchanged layers and regions from the previous frame and edit the moving parts. Small sprites often need few frames; add frames only where the motion becomes clearer.

## Working recipes

These are Pixelator's own starting points, distilled from the principles above; they are not quotations from the cited sources. The request and the project style override them.

**Order of work.** (1) Silhouette in one flat color per part, each part on its layer; check it with `inspect_asset` `mode: "silhouette"`. (2) Two or three flat color masses. (3) One shadow and one highlight step per material along a ramp, from the chosen light direction. (4) Outline or selective outline. (5) A few single-pixel accents such as eyes and a glint. Look at the image after each step, not only at the end.

**Size budget.**

- 16×16: a character's head takes about half the height; eyes are single pixels with two pixels between them; 2–3 tones per material and 6–10 colors in total. An outline costs two of sixteen pixels per axis, so keep it only where the shape still reads.
- 32×32: head about a third of the height; 3 tones per material plus a one-pixel highlight; room for 2×2 eyes, hands and a belt; 10–16 colors.
- 48–64: 3–5 tones per material; anti-aliasing on curves starts to pay off; interior lines can take a darker tone of the material instead of the outline color.
- Scenes and backgrounds: depth planes on separate layers; far planes get fewer tones, lower contrast and no outline.

**Ramps.** Shade along the named ramps of the palette (`ramps` in the asset, names in the `read_pixels` legend) and name the roles of a new palette with `palette_names`. Never darken by mixing in black. Where two materials touch, their neighboring tones must stay apart in `mode: "values"`.

**Outline.** One weight per asset family. A full dark outline suits sprites that move over busy backgrounds; a selective outline uses a darker tone of the neighboring material and is lighter on lit edges; backgrounds need none. `outline` with `corners: false` draws the thin line; remove doubled corner pixels afterwards.

**Animation budget.** Idle: 2–4 frames of 200–400 ms; the upper body moves one pixel, the feet stay. Walk: 4 frames (contact, passing, contact, passing), 6–8 for large sprites, 80–140 ms each. Attack: anticipation held 120–200 ms, strike 40–80 ms, impact held 100–160 ms, recovery. Hit: 2 frames. Effects: 4–6 frames that shrink toward the end. Put what all frames share on every frame at once with `frameIds`, draw the key poses, then the in-betweens.

**Family consistency.** Before drawing and before finishing, view the asset next to its siblings with `inspect_assets`: same head-to-body ratio, outline weight, number of tones per material, light direction and saturation. Reuse shared parts with `stamp` and `sourceAssetId` instead of redrawing them.

## Worked examples

Rows for the `16-bit` preset palette, light from the upper left. They show how much each pixel has to decide at 16×16, not a style to copy. Draw them with `{ "op": "rows", "layerId": "body", "x": 0, "y": 0, "rows": [...] }`.

Slime: dark slate outline `f`, green `b`, lime highlight `a` on the lit side, dark green shadow `d` on the far side, one white glint `m`, eyes `2`.

```
................
................
................
................
.....ffffff.....
...ffaaaabbff...
..faaaabbbbbbf..
.faamabbbbbbbbf.
.fabbbbbbbbbbdf.
fabbb2bbbb2bbbdf
fbbbb2bbbb2bbbdf
fbbbbbbbbbbbbddf
fbbbbbbbbbbbdddf
fdbbbbbbbbdddddf
.fdddddddddddff.
..ffffffffffff..
```

Potion: the neck and stopper explain the object; glass `l`/`n`, liquid `s` with a rose lit side `t` and a dark plum far edge `3`.

```
................
......2222......
......2752......
......2222......
......2ln2......
......2ln2......
.....22ln22.....
....22llnn22....
...2lllnnnnn2...
..2ltttsssss32..
..2tmtssssss32..
..2ttsssssss32..
..2tssssssss32..
...2sssssss32...
....22333322....
......2222......
```

Hero: big head, one-pixel eyes two pixels apart, hair shadow `4` on the far side, tunic `i` with highlight `j` and shadow `g`, hands in skin `8` to separate the arms.

```
................
.....222222.....
....25555552....
...2555555452...
...2548888452...
...2482882842...
...2488888842...
....27888872....
....22iiii22....
...28jiiiig82...
...28iiiiig82...
...22iiiigg22...
....2gggggg2....
....24422442....
....24422442....
....22222222....
```

A second idle frame for the slime changes only what moves: `duplicate_frame` (`frameId: "idle_1"`, `id: "idle_2"`), then `{ "op": "move", "layerId": "body", "frameId": "idle_2", "rect": { "x": 0, "y": 4, "width": 16, "height": 9 }, "dx": 0, "dy": 1 }`. The dome sinks by one pixel while the two base rows stay on the ground line.

## Required visual review

Inspect the exact current revision with `inspect_asset` at an enlarged integer scale and small on the intended game background, for example `scales: [1, 8]` with `background` (when the game background is unknown, on a dark and a light color); for sprites of 32 pixels or less, `[2, 8]` is easier to judge than a 16-pixel image. Zoom into details with `rect`, check the shape with `mode: "silhouette"` and material contrast with `mode: "values"`. For animations inspect every frame, as one sprite sheet or in several parts, with onion skin when judging motion. Review the actual PNGs. If the client cannot show them, finish as `needs_review`.

A review by fresh eyes finds more than a self-check. When the client can start a separate agent, give it only the task, the asset ID and this checklist, let it inspect the asset and report defects, and record its findings with `reviewer: "independent"`.

In `record_review.observations`, give concrete evidence for each applicable point; mark a point not applicable with a reason rather than inventing a problem:

- **Readability:** silhouette, pose and defining features at native size.
- **Clusters/edges:** intentional details, clean contours, noise and banding.
- **Palette/light:** value separation, material and consistency with the chosen light.
- **Style/context:** proportions, perspective, palette and outline match the asset family; edges remain useful on the intended game background.
- **Edit fidelity:** requested change is visible; unrelated pixels, locked layers, pivot and palette remain intact unless requested.
- **Motion (animations):** loop seam from last to first frame, timing and holds, anchor stability on the pivot, silhouette in every frame, no unintended jitter, consistent volume and proportions.

List unresolved defects in `issues`, then fix only observed problems within the existing correction budget. Reinspect and review after the last edit. Technical validation and an empty issue list do not independently prove artistic quality. This review procedure is Pixelator's application of the cited guidance.
