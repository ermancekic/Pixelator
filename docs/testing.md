# Testing and acceptance

The automated checks run with `npm run typecheck`, `npm test` and `npm run build`. Passing them proves neither artistic quality nor image delivery to an agent client. The real run-throughs below are a separate acceptance; this document does not claim that it has already taken place.

## Technical integrity

| Area | Expectation |
| --- | --- |
| Raster and palette | Only allowed sizes and indices; index `0` transparent; visible colors within the limit. |
| Atomic editing | An invalid command discards the whole batch; no partially saved change. |
| Local edit | Raster values outside the allowed layer and rectangle stay exactly the same. Moving accounts for both the source and the target area. |
| Locked layer | Drawing and structural changes do not bypass the lock. |
| Revisions | Old revisions stay readable; restoring creates a new current revision. |
| Deletion | The confirmation names the asset or project and the permanent scope. Revisions, replay requests and runs are removed atomically. Variants stay independent; other projects unchanged. External deletions clear the affected view and close stale delete dialogs. |
| Large rasters | Fill and preview stay pixel-accurate; fast strokes lose no intermediate points. Small thumbnails use bounded pixel buffers. The history returns metadata and loads historical rasters individually. |
| Concurrency | A stale `expectedRevision` is rejected; the same `requestId` with the same payload creates no duplicate change. |
| Rendering and export | Nearest-neighbor preview; PNG with correct dimensions and real alpha; JSON and Unity metadata match the revision. |
| Persistence | After a service restart, projects, assets and revisions are present again. |
| Artist run | Cancellation and limits keep the last valid state; finishing checks the current state instead of an old review state. |
| Artist Guide | Current rules consistently available via `get_workflow`, the resource and start/resume; style context with the PNG. |
| Navigation/hotkeys | Zoom keeps the point under the mouse pointer in place, stays integer and bounded; panning changes no raster data; inputs and dialogs block editor shortcuts. |
| Panel layout | Drag the width of library/properties and the height of timeline/preview/palette/layers; minimum sizes protect the canvas. Sizes persist after a reload. Double-click or Enter resets the panel; arrow keys and Home/End resize without triggering editor shortcuts. When the window shrinks, panels stay reachable; on mobile, desktop sizes are ignored. |
| Drawing symmetry | Pencil, eraser, line and shapes mirror across the canvas center; even/odd dimensions and combined axes produce correct, unique points. Selection bounds apply to every target; a stroke stays one revision. |
| Pixel-perfect pencil | L-shaped kinks are optionally corrected; straight lines, direction changes and repeated points stay correct. The original color appears under removed corner points. Preview and saved stroke match; canceling discards the preview. |
| Fill reference and extent | Defaults preserve the previous fill behavior. Contiguous/global and layer/whole image work, including transparency, hidden layers, selection and locks. Only the target layer is written; identical reference and target colors do not prevent necessary target changes. |
| Layer duplication | Separate pixel buffer, new unique ID, copy directly above the source; source unchanged, visibility/lock preserved. Scope, layer limit and atomic error handling apply; browser and MCP reach the same operation. |
| Compact rasters (`rows`, `read_pixels`) | `rows` produces the same document as `patch`; `over` keeps pixels under `.`; `read_pixels` → `rows` is lossless; areas over 16,384 cells are rejected. |
| Frames and scope | Drawing operations target exactly one frame; without an unambiguous frame, `FRAME_REQUIRED`. Frames outside `editScope.frameIds` demonstrably stay the same. Frame structure changes require all layers, no rectangle and `allowFrameChanges`. |
| Tags | Inserting inside/after a tag extends it, inserting before it shifts it; deleting its only frame removes it (Pixelorama rules). Duplicate names and invalid ranges are rejected. |
| Legacy data | Stored documents without frames, old replay responses and version 1 project bundles are read as one frame without changing pixels. |
| Animation inspection | `inspect_asset` shows all frames as one sheet with a gutter color outside the palette; onion tints only neighboring frames and only transparent spots. `completed` requires an inspection of all frames. |
| Animation export | Sheet PNG pixel-identical to the individual frames; Aseprite JSON with rectangles, durations, tags and pivot; Unity with one sprite per frame (origin bottom left) and one clip per tag; GIF with durations, transparency, tag direction and loop. An exported sheet can be re-imported losslessly as frames. |
| Timeline in the editor | Adding/duplicating/moving/deleting frames and changing duration/tags each create one revision with undo/redo. Drawing hits only the selected frame. Playback uses the real durations; onion skin changes no data. |
| Selection masks | `editScope.mask` allows writes only to `#` pixels in the rectangle; fill, replace and outline stay inside it, other operations are rejected. Lasso, magic wand, add/subtract and moving/flipping/rotating freeform selections change only selected pixels. |
| Canvas size | `resize_canvas` enlarges, shrinks and shifts all layers and frames, moves the pivot along, updates the asset size and refuses to cut off locked pixels. Cropping to selection/content and restoring older sizes work. |
| Merge layers | The result lands in the lowest layer, the whole image stays pixel-identical; visible intermediate layers, locked or hidden sources are rejected. All frames are merged. |
| Clipboard | Copy/paste within an asset is pixel-identical; between palettes, colors are matched exactly, appended or approximated. Pasting as a layer is one revision; external PNGs from the system clipboard are read. |
| Brushes, patterns, shading | Brush sizes and shapes, canvas-aligned patterns with an optional secondary color, and shading along palette/brightness; transparency stays unchanged when shading. |
| Palette files and export | GPL/PAL/HEX/TXT are read and GPL/PAL/HEX are written; “Map pixels” replaces each pixel with the closest color. PNG, sheet and GIF can be exported at 1–16×; the sheet JSON addresses the enlarged image. |
| Export window | Each format lists its files with their server URLs; the sheet and tileset preview is pixel-identical to the downloaded file, text formats show the file contents. Multiple files are all downloaded; unsuitable formats (sheet/GIF without animation, tileset without grid) are disabled. Settings persist. |
| Menu bar and settings | Menus via mouse and keyboard; items trigger the same commands as toolbars and shortcuts. Library, properties, timeline and grids can be hidden; language and view survive a reload. |
| Language | English is the default. Every interface text has an English translation with the same placeholders; no German text appears in the English interface. Server messages are in English and translated in the German interface. |
| Reference image | Behind/above the drawing, opacity and fit adjustable; no change to the document, revisions or exports. |
| Tileset grid | Grid only with a divisible canvas; tile IDs row by row; metadata (name, class, probability, collision within the tile area, terrain only at positions the mode reads) is validated. A new tile size resets the metadata; canvas changes by whole tiles carry it along, others are rejected. |
| Autotiles | Blob 47, Edges 16 and Corners 15 are built from the key tiles, labeled and complete; odd tile sizes and grids that are too small are rejected with size information. Missing combinations produce `TERRAIN_INCOMPLETE` and magenta cells in the test map. |
| Seamless and offset | Strokes and shapes continue across the edge on wrapping axes; `shift` offsets with wraparound, only within the rectangle. Ghost tiles change no data. |
| Tileset export | PNG with extrude/spacing; animated tiles as row blocks; Tiled TSX/TSJ with class, name, collision, animation and Wang set; Godot `.tres` with terrain mode, peering bits, physics, custom data and animation; Unity manifest. Godot loads the TileSet, and its terrain brush picks the same tiles as the test map; a Tiled parser reads TSX and TSJ identically. |
| Project overview | `GET /api/projects/overview` returns the asset count, last change and up to four most recently changed assets per project. The window sorts by activity, marks the open project, searches, switches by click, arrow keys and `Enter`, closes with `Esc` and stays free of horizontal scrolling on mobile. |
| Preview and tiling | “Fit” shows the whole image, with large images scaled down; 1×/2×/4×/8× show fixed pixel sizes, large images scroll. Background switching and 3×3 repetition change no document data. An in-progress stroke and a historical revision are displayed correctly. |

## Real MCP run-through

Test separately with the Codex/Claude/Antigravity clients actually in use. The app must neither load a model nor start an agent in the process.

1. Start the service, connect the client over MCP and load the Pixel Artist skill. Note the client version, model and transport.
2. Create a 32×32 skeleton with a separate sword layer. `inspect_asset` must return a real PNG as MCP image content. Verify that the agent can actually evaluate this image visually; a link or JSON with image dimensions is not enough.
3. Record a concrete visual observation with the associated revision ID. Make a visible improvement, inspect again and assess.
4. Lengthen the sword by exactly three pixels. Compare the before/after rasters: all pixels outside the allowed area must stay unchanged.
5. Check the final revision, generate the PNG and Unity export and open the same state in the browser. Verify transparency and pivot.
6. Cancel a run and hit a limit. The last valid state is preserved. Simultaneous manual editing must trigger a conflict instead of a silent overwrite.

If a client cannot forward image responses, this artist workflow is not yet accepted there. `record_review` proves a logged observation, not visual understanding by the model.

## Visual sample: 20 real tasks

Run each task with the real external agent. Keep the first complete drawing and the final revision after at most three correction rounds. Judge subject and style at native size and enlarged: recognizable, readable in-game, requirements met, better/same/worse after correction. Record duration, client/model, asset/revision IDs and open issues. Do not derive any assessment solely from the drawing agent's self-assessment.

| No. | Task | Focus |
| --- | --- | --- |
| 01 | 32×32 Skeleton Warrior, 16-bit, side | Silhouette and separate sword |
| 02 | 32×32 goblin with dagger, 16-bit, side | Face and gameplay features |
| 03 | 32×32 knight with shield, 16-bit, front | Readable equipment |
| 04 | 16×16 slime enemy, Game Boy, front | Small resolution and palette |
| 05 | 48×48 robot, 8-bit, front | Proportions and material |
| 06 | 64×64 boss skeleton, 16-bit, side | Detail discipline on a larger grid |
| 07 | 16×16 iron sword, 8-bit | Diagonals and metal colors |
| 08 | 16×16 health potion, Game Boy | Glass and recognizability |
| 09 | 16×16 key, 1-bit | Shape with a small palette |
| 10 | 24×24 iron shield matching No. 07 | Asset family and reference inspection |
| 11 | 32×32 wooden crate, 8-bit, front | Outline and light |
| 12 | 32×32 oak tree, Game Boy, front | Organic silhouette |
| 13 | 24×24 rock, 16-bit, front | Surfaces and shading |
| 14 | 48×48 dungeon door, 16-bit, front | Symmetry and contrast |
| 15 | 8×8 heart icon, 1-bit | Minimal resolution |
| 16 | 16×16 inventory bag, 8-bit, front | UI readability |
| 17 | Lengthen the sword from No. 01 by 3 pixels | Measurable local change |
| 18 | Change only the armor colors of No. 03 | Identity and unchanged surroundings |
| 19 | Create an elite variant of No. 02 | Independent variant and provenance |
| 20 | Damaged version of the crate from No. 11 | Recognizable base shape |
| 21 | 32×32 skeleton from No. 01: 4-frame idle and 6-frame walk, tags `idle`/`walk` | Anchor stability at the pivot, loop transition |
| 22 | 16×16 slime: 2-frame hop with squash | Volume and timing |
| 23 | 16×16 coin: 6-frame spin, export GIF and sheet | Even rotation, import the export into an engine |

Technical acceptance requires error-free integrity checks. The visual sample documents the quality achieved, including failures; it is not a general guarantee for all subjects, styles or agent models.
