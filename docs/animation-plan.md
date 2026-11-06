# Implementation plan: AI efficiency and animations

As of 17 October 2026 · Baseline: Pixelator `332beea` · Reference: Pixelorama [`845de22`](https://github.com/Orama-Interactive/Pixelorama/tree/845de22bd1b7fa43edf3024589a23c3e59c07ba2) (MIT). The plan has been implemented; section 8 lists the decisions made and the deviations, and the verification results are in the [verification report](verification.md).

## 1. Summary (starting point)

- **Creating assets with AI: yes, but not yet as efficiently as possible.** The engine, scope protection, revisions and real PNG inspection already support the agent workflow (real Codex run: 32×32 skeleton in 79 s, see [verification report](verification.md)). The bottlenecks lie in the data format: rasters go back and forth as JSON number lists, a sub-region cannot be read compactly, two zoom levels need two calls, and every edit returns the full asset context.
- **Animations: no.** `PixelDocument` has exactly one image per layer ([types.ts:4](../src/types.ts)). There are no frames, durations, tags, playback or sprite sheets; the skill explicitly forbids claiming animation ([SKILL.md:30](../skills/pixel-artist/SKILL.md)).
- **Recommendation:** First the efficiency foundations (Phase 0), then a document model v2 with frames modeled on Pixelorama (Phase 1), then animation over MCP (Phase 2), and after that the timeline in the editor (Phase 3). This way agents can create animations before the browser timeline is finished.

## 2. Current-state analysis

### 2.1 Architecture

| Module | Responsibility |
| --- | --- |
| [`src/engine.ts`](../src/engine.ts) | Deterministic raster engine: validation, compositing, 20 operations, scope check, diff. Used by the server **and** the browser (`previewOperations`). |
| [`src/store.ts`](../src/store.ts) | SQLite (`node:sqlite`): projects, assets, immutable revisions (full document per revision), idempotency (`requests`), artist runs with a budget. |
| [`src/mcp.ts`](../src/mcp.ts) | MCP server with 20 tools and 2 resources; `inspect_asset` returns a real PNG as image content. |
| [`src/server.ts`](../src/server.ts) | Fastify: REST for the editor, SSE events, Streamable HTTP MCP with session and agent status. |
| [`src/images.ts`](../src/images.ts) | PNG rendering (nearest neighbor), thumbnail, lossless PNG import, Unity metadata. |
| [`web/App.tsx`](../web/App.tsx) | React editor (one component, ~480 dense lines): tools, layers, palette, history, MCP dialog. |
| [`skills/pixel-artist`](../skills/pixel-artist/SKILL.md) | Agent workflow and Artist Guide, delivered via `get_workflow`. |

### 2.2 What already works well for AI agents

- Atomic batches with up to 512 operations, shapes (`line`, `rect`, `ellipse`, `polygon`, `fill`, `outline`) instead of individual pixels.
- `editScope` with layers and a rectangle protects uninvolved pixels; diff check at the storage and render level.
- `expectedRevision` and `requestId` prevent overwrites and double application.
- `inspect_asset` returns the real image; the agent judges visually instead of from JSON.
- The run budget (120 batches, 1 + 3 reviews) limits costs and endless loops.

### 2.3 Efficiency bottlenecks (measured)

Measured on 17 October 2026 against an in-memory server over MCP JSON-RPC, synthetic 32×32 sprite. Response sizes include the text copy **and** the `structuredContent` copy (see `jsonResult`, [mcp.ts:38](../src/mcp.ts)); which copy the model sees depends on the client.

| Call | Characters | Finding |
| --- | ---: | --- |
| `tools/list` | 23,512 | Once per session; mostly the operations schema. Acceptable; add new tools sparingly. |
| `get_workflow` | 24,475 | Once per task; `start_run`/`resume_run` additionally send the Artist Guide again. |
| `patch` 32×32 as JSON numbers | 2,232 | The agent's input for a full layer block. |
| the same as row strings | 1,171 | **−48% characters**; tokens probably drop even more, because runs of identical characters compress well (re-measure with a real tokenizer at acceptance). |
| `apply_operations` response | 3,310 | Full asset and revision context on **every** batch, although the agent usually only needs the new revision ID. |
| `get_asset` with `includePixels` | 7,376 | Whole layers as number lists; no region, no single layer, no compact encoding. |
| `inspect_asset` (scale 8) | 1,436 + 1,285 | Image (Base64) plus JSON; efficient. But according to the skill, scale 1 and enlarged are two calls. |

Further gaps:

1. **No compact reading of a region.** For precise local edits, the agent must either guess or load complete layers.
2. **No reuse of pixel regions across layers.** `copy` only works within one layer; for animation (carry over the pose from frame 1, move it, change it locally) this is the most important lever.
3. **No overall view of related images.** For variants and frames, the agent needs a contact sheet instead of many individual inspections.

### 2.4 Animation today

Not available: no frame concept in [types.ts](../src/types.ts), [contracts.ts](../src/contracts.ts) or the engine; export only as single PNG/JSON/Unity single sprite ([images.ts:71](../src/images.ts)). As a workaround, frames could be created as separate variants, but without a shared layer structure, timing, tags, playback or sprite sheet, and with separate runs/reviews. That is not an animation but a collection of assets.

## 3. Pixelorama as a reference

Concepts and observed behavior are adopted, but no GDScript code (as in the [previous report](../reports/Pixelorama%20Ideas%20for%20Pixelator.md)).

| Concept | Pixelorama | Decision for Pixelator |
| --- | --- | --- |
| Frames and cels | `Project.frames`, `Project.layers` ([Project.gd:56–57](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Project.gd#L56-L57)); each frame holds one cel per layer ([Frame.gd:6](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Frame.gd#L6)). | Same structure: layers global, `frames[].cels[layerId]`. Semantic layers (`body`, `sword`) stay consistent across all frames. |
| Timing | Project `fps` plus a duration multiplier per frame ([Frame.gd:7,16](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Frame.gd#L7-L17), [Project.gd:82](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Project.gd#L82)). | `durationMs` per frame. Engine-neutral, directly usable for Aseprite JSON, Unity and Godot; no conversion when the FPS changes. |
| Tags | Name, color, `from`/`to` 1-based inclusive ([AnimationTag.gd:42–45](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/AnimationTag.gd#L42-L45)). | Index-based, but **0-based** inclusive, plus `direction` and `loop`. Color only derived in the UI. |
| Tag adjustment | Inserting inside/directly after a tag extends it, inserting before it shifts it; deleting its only frame removes the tag (`undo_redo_add_frames`, `delete_frames`, [AnimationTimeline.gd:432, 478](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L432)). | Identical rules in the engine, locked in by tests. |
| Copying a frame | Copy directly after the source, same duration, cels deep-copied or linked ([AnimationTimeline.gd:549](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L549)). | `duplicate_frame` with a deep copy. Linked cels (`link_set`, [BaseCel.gd:17](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Cels/BaseCel.gd#L17)) only in Phase 4. |
| Playback | Loop `NO`/`CYCLE`/`PINGPONG`, forward/reverse, optionally current tag only ([AnimationTimeline.gd:13, 804, 877](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L804)). | Same behavior as a pure function in `web/animation-helpers.ts`. |
| Onion skin | Previous/next frames with `opacity / i`, blue/red mode, layers can be excluded via `ignore_onion` ([OnionSkinning.gd:29–37](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Canvas/OnionSkinning.gd#L29-L37)). | In the editor as a pure view; additionally in MCP `inspect_asset` as an overlay for the agent. |
| Export | Sprite sheet by columns/rows/tags, direction forward/reverse/ping-pong, formats incl. GIF/APNG ([Export.gd:4–8, 219](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Autoload/Export.gd#L219)). JSON export is the internal project format ([Export.gd:583](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Autoload/Export.gd#L583)). | Sheet PNG plus **Aseprite-compatible JSON** (read by many engines/importers) and Unity metadata with multiple sprites. GIF in Phase 4. |
| Not adopted | Cel opacity, z-index, blend modes, group, 3D, audio and tilemap layers. | Does not fit the binary-alpha index raster; not a product goal. |

## 4. Target design

### 4.1 Document model v2

```ts
export interface PixelLayer { id: string; name: string; visible: boolean; locked: boolean }
export interface PixelFrame {
  id: string;                       // identifier like layer IDs, e.g. "walk_1"
  durationMs: number;               // integer 10..60000
  cels: Record<string, number[]>;   // key = layer.id, length width*height
}
export interface AnimationTag {
  name: string;                     // unique
  from: number; to: number;         // 0-based, inclusive
  direction: 'forward' | 'reverse' | 'pingpong';
  loop: boolean;
}
export interface PixelDocument {
  schemaVersion: 2;
  width: number; height: number;
  palette: string[]; maxColors: number; paletteLocked: boolean;
  layers: PixelLayer[];             // bottom → top, same for all frames
  frames: PixelFrame[];             // ≥ 1, playback order
  tags: AnimationTag[];
  pivot: { x: number; y: number };  // shared by all frames (stable anchor point)
}
/** One frame in the previous v1 form. Input for drawing operations and renderers. */
export interface FrameView {
  width: number; height: number; palette: string[];
  layers: (PixelLayer & { pixels: number[] })[];
}
```

A single image is a document with one frame. So there is **one** code path, no special handling for “animated/not animated”.

**Invariants** (in `validateStructure`): 1–64 frames with unique IDs; every frame has cels for exactly the set of layer IDs; every cel has `width*height` valid indices; `durationMs` is an integer within range; tags uniquely named, `0 ≤ from ≤ to < frames.length`, at most 32.

**ValidationReport v2:** `colorCount` across all frames, `opaquePixels` as a sum, `boundingBox` as a union (useful for trimming), new `frames: { frameId, opaquePixels, boundingBox }[]` and the warning `EMPTY_FRAME`.

**PixelDiff v2:** additionally `changedFrames: string[]`; `changedPixels` counts changed (frame, position) pairs.

### 4.2 Frame resolution and EditScope

```ts
export interface EditScope {
  layerIds: string[]; rect?: Rect;
  frameIds?: string[];            // new; omitted = all frames writable
  allowPaletteChanges?: boolean; allowLayerChanges?: boolean;
  allowFrameChanges?: boolean;    // new; frame, timing and tag structure
}
```

- Every raster operation gets an optional `frameId`. Resolution: `op.frameId` → the only entry in `editScope.frameIds` → the document's only frame → otherwise error `FRAME_REQUIRED`. Existing calls on single images thus stay valid.
- The diff checks changes per (frame, layer, position) against the scope. A frame outside `frameIds` provably stays unchanged (`SCOPE_VIOLATION`).
- Palette and layer structure changes affect all frames and therefore additionally require that `frameIds` is omitted or contains all frames.
- Frame structure operations require `allowFrameChanges`, no `rect`, and the affected frames in the scope.

### 4.3 New operations

| Operation | Fields | Behavior |
| --- | --- | --- |
| `rows` *(Phase 0)* | `layerId, frameId?, x, y, rows: string[], mode?: 'replace' \| 'over'` | Compact patch. Alphabet: `.` = 0 (transparent), `1`–`9`, `a`–`w` = index 1–32. `over` lets `.` keep the existing pixels. |
| `stamp` | `layerId, frameId?, sourceLayerId?, sourceFrameId?, rect?, dx, dy, mode?: 'over' \| 'replace'` | Copy a region from any layer/any frame of the same document and offset it. Core operation for reusing poses. Clipping rules like `move`. |
| `add_frame` | `id, index?, durationMs?` | Empty cels for all layers; default: at the end, 100 ms. |
| `duplicate_frame` | `frameId, id, index?` | Deep copy of all cels and the duration; by default directly after the source. |
| `remove_frame` | `frameId` | Not the last remaining frame. |
| `reorder_frames` | `frameIds` | Complete permutation; tags stay position-based. |
| `frame_duration` | `frameIds, durationMs` | Timing of several frames in one operation. |
| `set_tags` | `tags: AnimationTag[]` | Replaces the tag list atomically. |

Existing raster operations only get `frameId?`. `add_layer`, `duplicate_layer` and `remove_layer` affect all frames (new cels empty or copied, respectively). Tag adjustment on insert/delete follows the Pixelorama rules from section 3.

**Implementation principle in the engine:** `editDocument` remains the only editing function. Raster operations go through `frameView(doc, frameId)` and write back into the cels. The existing ~300 lines of drawing logic stay unchanged in substance.

### 4.4 Rendering and export

- `composite(doc, frameId?)`, `renderPng(doc, scale, frameId?)`; the thumbnail uses the first frame.
- `renderSheet(doc, { frameIds?, tag?, columns?, scale, gutter?, onion? })` returns a PNG and layout (`frameId, x, y, w, h, durationMs` per cell).
- **Export `sheet`:** sheet PNG (no spacing by default) plus JSON in Aseprite “Array” format: `frames[]` with a `frame` rectangle and `duration`, `meta.size`, `meta.frameTags` (`name`, `from`, `to`, `direction`), extension `meta.pivot`.
- **Export `unity`:** with multiple frames `spriteMode: 'Multiple'`, sprite rectangles with the origin at the bottom left, normalized pivot, `clips[]` per tag with sprite names, durations and loop. As before, metadata only, no changes to a Unity project.
- **Export `png`:** a single frame via `frameId`, first frame by default.

### 4.5 MCP interface

Only one new tool; everything else extends existing tools.

| Tool | Change |
| --- | --- |
| `read_pixels` *(new, Phase 0)* | `assetId, revisionId?, frameId?, layerId?` (omitted = visible composite image), `rect?` → `rows` in the alphabet of `rows`, plus a legend (index → hex). At most 16,384 cells per call. Replaces `includePixels` for the normal case. |
| `apply_operations` | New operations and scope fields. The response is **compact** by default: `assetId, revisionId, parentId, diff, validation` (without the document), `frames` (IDs, durations), `layers` (IDs). `response: 'full'` returns the previous format. |
| `inspect_asset` | `scales?: number[]` (up to 3 images in one call, Phase 0). New: `frameId?`, `layout?: 'frame' \| 'sheet'`, `frameIds?`, `tag?`, `columns?`, `onion?: { before?: 0..3, after?: 0..3 }`. With multiple frames, `sheet` is the default: **one** image with all frames, separated by a gutter color outside the palette; layout in the JSON. Onion frames as a fixed tint (before blue, after red) beneath the target frame. |
| `create_asset` | Optional `frames: { id, durationMs? }[]` and `tags`. |
| `get_asset` | Summary with frames, durations and tags; `includePixels` stays compatible, optionally with `frameIds`. |
| `export_asset` | Formats `png` (with `frameId`), `json`, `unity`, `sheet` (writes PNG and JSON side by side), later `gif`. |
| `get_workflow` | Limits extended with `frames: 64`, `tags: 32`. |
| Runs | `inspected` additionally stores the frame IDs shown. For animations, `finish_run('completed')` requires an inspection that covers all frames. |

**Why a sheet instead of a GIF for the agent:** Vision models process MCP image content as a still image; an animated GIF usually shows the model only one frame. A contact sheet shows motion, the silhouette per frame and anchor stability at a glance.

**Efficient animation workflow for agents** (goes into the skill): draw the key pose in frame 1 → `duplicate_frame` → shift on layers via `stamp`/`move` → correct locally with `rows` → `inspect_asset` as a sheet with onion skin → review → timing via `frame_duration` → `set_tags` → export `sheet`.

### 4.6 Web editor

- **New file `web/Timeline.tsx`:** frame thumbnails, current frame, duration input in ms, add/duplicate/delete/move frames, tag bar above the frames with a dialog (name, range, direction, loop), play/pause, loop mode (once/cycle/ping-pong), “current tag only”, onion skin toggle (before/after 0–3).
- **New file `web/animation-helpers.ts`:** pure functions for the playback range, next frame (all loop modes, both directions), onion frame selection and tag layout. Unit-tested like `view-helpers.ts`.
- **`web/App.tsx`:** only state wiring: `frameId`; all operations with `frameId` and `editScope.frameIds`; the eyedropper, layer thumbnails and selection patch read the current frame; onion canvas beneath the drawing surface (`pointer-events: none`, no document change). The copied agent prompt names the frame and tag.
- **`web/AssetPreview.tsx`:** plays the animation with real durations, independent of the frame being edited (like Pixelorama's preview); 3×3 tiling remains.
- **Keyboard shortcuts** (`resolveShortcut`): `,` / `.` previous/next frame, `K` play/pause, `Shift+O` onion skin.

### 4.7 Migration and compatibility

- `upgradeDocument()` (pure, in the engine): v1 → v2 with one frame `frame-1`, 100 ms, no tags; pixels go unchanged into the cels.
- **No rewriting of the database.** Revisions are upgraded when read, new revisions are stored as v2. This also applies to stored replay responses in `requests` ([store.ts:205](../src/store.ts)), so that retries do not return the v1 form.
- Project import accepts bundles with `schemaVersion` 1 and 2 and documents v1 and v2; export writes version 2.
- REST/MCP clients see the new form. Agents read schemas dynamically; the skill and Artist Guide are updated in the same phase.

## 5. Phases

Effort as a rough size (S/M/L). Every phase ends with a green `npm run typecheck`, `npm test`, `npm run build` and can be shipped on its own.

### Phase 0 – Efficiency for all assets (S–M)

1. `rows` operation: contract in `contracts.ts`/`types.ts`, engine case next to `patch`.
2. `read_pixels` tool in `mcp.ts`, encoder/decoder as a shared helper function in `src/engine.ts` (or `src/raster-text.ts`).
3. `inspect_asset` with `scales[]` (multiple image contents in one response).
4. Compact `apply_operations` response with `response: 'full'` as a fallback.
5. Skill: use `rows`, `read_pixels` and `scales` in the workflow; example with `rows` instead of `patch`.

**Acceptance:** `rows` and `patch` produce identical documents; `read_pixels` → `rows` is lossless; two scales in one call; the compact response contains the new revision ID and no document. Repeat the measurement from section 2.3 and record the result in [verification.md](verification.md).

### Phase 1 – Document model v2 and engine (L)

Recommended commit order, so that every step stays verifiable:

1. Types, schema (`documentSchema` as a union of v1/v2), `upgradeDocument`, `frameView`; test helper `cel(doc, layerId, frameIndex = 0)`. Convert all tests mechanically (about 70 accesses to `.pixels` in `tests/`), **without behavior changes**.
2. Engine: frame resolution, scope (`frameIds`, `allowFrameChanges`), diff and validation per frame.
3. Frame operations including tag adjustment; `stamp`.
4. Store: upgrade on read incl. replay, `createDocument` with frames, import/export of bundle v2, `importDocument` empty check across all frames.
5. Renderer: `composite`/`renderPng` with `frameId`; the editor shows frame 1 for now (no timeline), so that nothing breaks.

**Tests (`tests/engine.test.ts`, `tests/store.test.ts`):** v1 → v2 lossless; a raw stored v1 revision and a v1 replay response are read as v2; v1 project bundle importable; every frame operation incl. limits and atomic rollback; tag rules (inserting in/after/before a tag, deleting a tag's only frame); `FRAME_REQUIRED`; write attempt on a frame outside the scope; `stamp` across frames/layers in both modes and with clipping; palette and locked layers across all frames; `changedFrames`; `EMPTY_FRAME`.

**Additional acceptance:** measure and document the revision size for 8 frames × 4 layers × 32×32 (expected roughly 70 kB of JSON per revision).

### Phase 2 – Animation over MCP (M)

1. `create_asset` with frames/tags; `get_asset` summary; `read_pixels` with `frameId`.
2. `renderSheet` with gutter color and onion skin; `inspect_asset` with sheet/frame/onion; run coverage of all frames.
3. Export `sheet` (PNG + Aseprite JSON), Unity with multiple sprites and clips, `png` per frame; REST: `/api/assets/:id/png?frameId=`, `/api/assets/:id/export?format=sheet|sheet-json`.
4. Skill and Artist Guide: animation workflow from 4.5; new review category **Motion** (loop transition last → first frame, timing, anchor stability on the pivot, silhouette per frame, no unintended pixel flicker). Research sources for animation rules during implementation and link them as in the existing guide. Remove the sentence “Animation … later extensions”.
5. Briefly extend `docs/mcp.md` and add a README bullet point (per AGENTS.md).

**Tests (`tests/server.test.ts`, `tests/images.test.ts`):** MCP run-through: create a 4-frame asset → `duplicate_frame` + `stamp` → `inspect_asset` returns exactly one image with the expected width (`n·w·scale` plus gutter lines); onion skin tints only neighboring frames; `finish_run('completed')` rejected without coverage of all frames; sheet PNG pixel-identical to the individual frames; JSON rectangles, durations and tags correct; Unity rectangles with a flipped y-axis.

**Real-world acceptance** (add to [testing.md](testing.md), result in [verification.md](verification.md)): 32×32 skeleton with a 4-frame idle and a 6-frame walk, tags `idle`/`walk`; feet stay on the pivot; import the sheet and JSON into an engine. Test separately with Codex and Claude; record batch usage against the run budget.

### Phase 3 – Timeline in the editor (L)

Files and behavior as in 4.6. **Tests:** `tests/animation-helpers.test.ts` (cycle, ping-pong, once, reverse, tag only, onion frame selection at the edges), shortcuts in `tests/view-helpers.test.ts`, preview in `tests/asset-preview.test.ts`. **Browser acceptance:** create/duplicate/move/delete frames incl. undo/redo, drawing affects only the current frame, onion skin changes no data, playback with real durations, an external agent change to another frame appears live.

### Phase 4 – Extensions (S–M each, as needed)

- GIF export (an index palette ≤ 32 colors and binary transparency fit GIF directly): a small dependency such as `gifenc` or a custom LZW encoder; decide during implementation.
- Sprite sheet PNG import with cell size → frames.
- Linked cels for static layers (Pixelorama `link_set`, `new_cels_linked`): edit once, takes effect in all linked frames; saves storage.
- Storage compaction of the cels (e.g. Base64/RLE only in SQLite, API unchanged), if the measurement from Phase 1 calls for it.
- Godot `SpriteFrames` export; `stamp` from another asset with the same palette for asset families.

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Revisions store the full document; frames multiply the size. | Phase 1 measurement; frame limit 64; compaction or linked cels in Phase 4. |
| Changing the document's shape breaks REST/MCP clients. | `schemaVersion`, upgrade on read, import of both versions, skill update in the same phase. |
| A large test conversion hides behavior bugs. | Conversion as a separate commit without behavior changes, new features only afterwards. |
| `App.tsx` becomes cluttered. | Timeline and playback logic in separate files, App only wiring. |
| The run budget (120 batches) is not enough for many frames. | Measure in the real-world acceptance test; only then tie the budget to the frame count if needed. |
| A compact response by default surprises existing agents. | `response: 'full'`; the skill mentions the switch; `get_asset` provides everything else. |

## 7. Open decisions (with recommendation)

1. **Timing:** `durationMs` per frame *(recommended)* or FPS × multiplier like Pixelorama.
2. **Tags:** index-based like Pixelorama/Aseprite *(recommended)* or bound to frame IDs.
3. **`apply_operations` response:** compact by default *(recommended)* or only on request.
4. **GIF:** small dependency *(recommended, less code)* or custom encoder.
5. **Frame limit:** 64 *(recommended for V1)*.

Pixelorama's MIT license remains documented as the origin of the examined concepts; no Pixelorama code, shaders or assets are copied.

## 8. Implementation status

Phases 0 to 3 are fully implemented, and from Phase 4 GIF export, sprite sheet import and a storage compaction.

**Decisions on section 7:** duration in ms per frame; index-based tags with Pixelorama's insert/delete rules; compact `apply_operations` response by default; frame limit 64. For GIF, contrary to the recommendation, a custom GIF89a encoder was chosen (about 60 lines): index palettes with at most 33 entries and binary transparency fit GIF directly, a dependency is avoided, and an independent decoder (Pillow) confirms the result.

**Deviations from and additions to the plan:**

- `create_asset` takes animation tags as `animationTags`, because `tags` there are already the asset's search terms.
- Unity metadata is split into `unityManifest` (single image) and `unitySheetManifest` (sheet with sprites and clips).
- By default, `inspect_asset` lays out sheets with at most 8 columns so that the inspection image stays compact for vision models; the export uses a horizontal strip.
- `stamp` reads other layers and frames without a write scope, like the whole-image reference when filling. Frame structure ignores layer locks like Pixelorama: locks protect against drawing in existing frames.
- Storage: The measurement showed that every replay response stored the full document a second time. Replay entries now contain only the revision ID and diff; this halves the storage per revision. Cel compaction and linked cels are not needed at about 70 KB per revision (8 frames × 4 layers × 32×32).
- Sprite sheet import: REST parameters `frameWidth`/`frameHeight` for arbitrary grids; the editor detects strips of square cells and asks the user.
- The server tests give light-my-request's mock socket the `destroySoon` of real sockets; without it, longer MCP tests crashed via a drain timer of the MCP transport (pre-existing, no effect in normal operation).

**Open:** linked cels, Godot `SpriteFrames` export, `stamp` from other assets, real agent acceptance testing of animation tasks 21–23 and the import of the exports into a real engine.
