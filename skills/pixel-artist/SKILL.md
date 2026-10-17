---
name: pixel-artist
description: Create, inspect and precisely edit game sprites in a running local Pixelator service through MCP. Use for Pixelator pixel art, asset variants and project style consistency; the existing agent performs the artist role.
---

# Pixel Artist

Use the connected Pixelator MCP tools. Pixelator stores and draws pixels; you make the artistic decisions. It contains no model or agent runner. Discover the available tool schemas rather than guessing arguments. If the service is unavailable, report the connection problem; do not substitute an unrelated image generator.

Before every artist task, call `get_workflow` and apply its current `artistGuide` throughout drawing and review. The same guide is available as `pixelator://artist-guide` and in [references/artist-guide.md](references/artist-guide.md). It covers silhouettes, clusters, palette/value control, lighting, edges and game readability, with primary-source links. The service supplies it again when starting or resuming a run, including when a locally installed copy of this skill is older.

## Create and improve

1. Read the project and its style with `list_projects`. Reuse a suitable project or create one. Resolve size, palette, perspective and lighting from the request and project; make small artistic decisions without repeated questions. Canvas width and height accept positive integers without a fixed resolution cap, subject to available memory and runtime limits. Front/side views are supported.
2. For a reference or variant, load the source with `get_asset` and **inspect its actual image**. Preserve its palette, proportions, lighting and important equipment. Use `create_variant` when continuing an existing asset family; reference metadata alone does not establish visual consistency.
3. Open an artist run with `start_run`, attaching the existing asset when editing or continuing a variant. For a new sprite, plan the silhouette, body and equipment, then create the canvas with `create_asset` and its `runId`. Use named semantic layers such as `body`, `armor` and `sword` so later edits remain local.
4. Construct the sprite with bounded `apply_operations` batches: shapes and lines for the silhouette and forms, followed by outline, shade and a few readable details. Each operation uses `op`, not `type`; for example `{ "op": "rect", "layerId": "body", "x": 10, "y": 8, "width": 6, "height": 9, "color": 2, "filled": true }`. Pixel indices refer to the document palette; index `0` is transparent. Reuse palette entries. Erase with index `0`. Do not generate a normal illustration and downsample it, use imagegen as a substitute, or execute drawing scripts outside the engine.
5. After a meaningful drawing stage, call `inspect_asset` with the current asset, revision and `runId`. It returns a real PNG as MCP image content. Inspect at `scale: 1` for game readability and an enlarged integer scale (for example `16`) for pixel cleanup. **Look at those images**. Once the first complete drawing is ready, call `record_review` for exactly that revision using the Artist Guide's review checklist, concrete observations and issues. Intermediate inspections need not consume the limited review budget. Do not infer the appearance solely from operations or validation JSON. If the client cannot deliver the image to you, report that limitation and finish as `needs_review` instead of claiming visual inspection.
6. Fix specific observed issues, inspect the new image and record another review. Allow at most three correction rounds after the first complete drawing. Respect the run's server limits and aim for ordinary tasks to finish within ten minutes. Stop sooner when improvements stall; retain the best valid result and name unresolved issues.
7. Call `validate_asset` and ensure the current final revision has been inspected and reviewed. Reuse its existing final review when no further edit occurred; do not spend another review merely to finish. Call `finish_run`: use `completed` when the requested work is done and technical checks pass; otherwise use `needs_review`. Return asset/revision IDs, a brief account of changes and any remaining limitation. Export with `export_asset` when requested.

## Precise editing

- Read the current document and revision before changing an existing asset. Identify the target layer and source/destination bounds; do not redraw the entire character for a local request.
- Supply `expectedRevision`, a unique `requestId`, `actor: "agent"` and the active `runId` on each operation batch. Retry a lost response with the **same** request ID and payload. On a revision conflict, reload and reassess the edit rather than overwriting newer work.
- Set `editScope.layerIds` and, for a local edit, `editScope.rect` to the smallest region covering the intended change. Include both old and new bounds when moving a part. Keep palette and layer structure changes disabled unless the task needs them. Palette replacement can affect the whole sprite.
- Preserve locked layers and everything outside the permitted scope. Inspect the result and its diff, then verify that the requested pixel-distance or color change actually happened. If the canvas prevents the edit, explain the constraint rather than silently resizing or clipping.
- Reuse stored revisions for comparison or recovery. `restore_revision` creates a new current revision; inspect that new revision before finalizing it.

Technical validity is measurable; silhouette readability, style, lighting and identity require visual judgment. Reviews and scores are observations, not proof of art quality. Animation, tilesets and asset-pack orchestration are later extensions; do not claim those exports exist without matching tools.

Judge small assets at their native size as well as enlarged. Reserve contrasting pixels for the features that explain the object: a character's face and equipment, or a bottle's neck and stopper. A correct outline and palette do not make a featureless shape game-readable.
