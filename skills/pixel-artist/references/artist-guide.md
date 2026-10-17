# Pixelator Artist Guide

Version: 2026-10-17.2. Apply this guide to every Pixelator creation, variant, edit and visual review. These are working defaults, not a mandate to change the requested aesthetic. Explicit user direction and the saved project/asset style take precedence; explain relevant departures in the review. A local edit must stay local even when unrelated art could be improved.

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

## Required visual review

Inspect the exact current revision with `inspect_asset` at `scale: 1` and at an enlarged integer scale. For animations inspect the sprite sheet of all frames, with onion skin when judging motion. Review the actual PNGs. If the client cannot show them, finish as `needs_review`.

In `record_review.observations`, give concrete evidence for each applicable point; mark a point not applicable with a reason rather than inventing a problem:

- **Readability:** silhouette, pose and defining features at native size.
- **Clusters/edges:** intentional details, clean contours, noise and banding.
- **Palette/light:** value separation, material and consistency with the chosen light.
- **Style/context:** proportions, perspective, palette and outline match the asset family; edges remain useful on the intended game background.
- **Edit fidelity:** requested change is visible; unrelated pixels, locked layers, pivot and palette remain intact unless requested.
- **Motion (animations):** loop seam from last to first frame, timing and holds, anchor stability on the pivot, silhouette in every frame, no unintended jitter, consistent volume and proportions.

List unresolved defects in `issues`, then fix only observed problems within the existing correction budget. Reinspect and review after the last edit. Technical validation and an empty issue list do not independently prove artistic quality. This review procedure is Pixelator's application of the cited guidance.
