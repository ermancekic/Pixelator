# Verified state · 17 October 2026

The first version is implemented locally and runs on a shared raster engine for the browser and MCP. This verification covers the state as of 17 October 2026; it is not a general guarantee for every subject or agent model.

## Addendum: Export window, menu bar and language

On 17 October 2026, **229 tests in 16 files**, the TypeScript check and the production build passed. Newly tested: every interface text from `t()`/`msg()` has an English translation with the same placeholders, with no orphaned entries; static and dynamic server messages are translated for the German interface; settings from browser storage are validated; fit zoom and the shortcuts `Ctrl+,`, `Ctrl+B`, `Ctrl+J`. Server messages are now English, including for MCP clients.

**Browser** (Chromium via Playwright, separate data folder) with 21 checks, passed several times in a row:
- English menu bar and `lang="en"` on first launch; menus via mouse and keyboard.
- No German text in the English interface: editor, all tools, menus, export formats, the Tiles section and all dialogs.
- Hiding and showing the timeline, properties and library (menu, `Ctrl+J`, `Ctrl+B`), also after reload; “Reset panel layout” restores a widened library, and the canvas stays rendered.
- Export: PNG with size and frame; download with a file name closes the window; settings are kept; sheet preview and tileset preview (extrude 1, spacing 2) pixel-identical to the file; `.tsx` preview identical to the download; sheet with JSON downloads both files; unsuitable formats disabled.
- The preview fits a 512×384 image at 29%; 1× shows 512 px.
- Switching to German translates the menus, the history entry “Asset created” and the server message “A valid PNG file is required.”, and persists after reload.
- No page or console errors.

The earlier browser runs (editor basics 22, tiles 13, project overview 14 checks) still pass, now in the German interface and with export through the window. At 1024, 820 and 390 px width there is no horizontal scrolling; below 900 px the menu bar is hidden.

**README banners:** header banner with English text, animated as a GIF (shine across the logo, blinking cursor, twinkling stars); footer banner animated (water, floating coins, portal, sparks, stars, blinking slime). Both GIFs carry over the colors of the source images losslessly.

**Not verified:** Firefox and Safari, especially multiple downloads from one click; screen reader output of the menus. Raster engine messages stay English in the German interface.

## Addendum: Project overview

Project selection is a window with project cards instead of a dropdown list. A server test checks the overview (asset count, last change, order and revision of the preview assets, empty project).

**Browser** (Chromium, separate data folder, four projects with drawn assets) with 14 checks:
- Sorting by activity, four preview images, the “Open” badge, plus style, asset count and modification time.
- Search with `Enter`, switching with the arrow keys and `Enter`, a hint for an empty result, `Esc`.
- “New project” from the window and the display without assets.
- Mobile width without horizontal scrolling.
- No page or console errors.

## Addendum: Tiles

On 17 October 2026, **218 tests in 15 files**, the TypeScript check and the production build passed. Newly tested: tile grid and metadata validation, `tileset`/`tile_properties`/`remove_tileset`, remapping on `resize_canvas`, `shift`, autotile composition (47/16/15 combinations, quarter and half-offset rules), terrain matching with probability, test map rendering, tileset layout with extrude, Tiled/Godot/Unity export, a REST and MCP run, and seamless drawing.

**External tools:** A 16×16 blob tileset generated with the engine (autotile from five key tiles, name, class, collision, probability, two frames, extrude 1) was exported and checked with the original tools.
- **Godot 4.3** (headless, official Linux release) loads the `.tres` with 47 tiles, terrain set “Gras” in mode 0, collision polygon around the tile center, custom data, probability 0.5 and animation; frame 2 sits correctly at pixel (73, 109).
- For a test shape, Godot's own terrain brush (`set_cells_terrain_connect`) chose **the same tile in 48 of 48 cells** as Pixelator's test map.
- **pytiled-parser 2.2.9** read TSX and TSJ identically: 96 tiles (2 frames), margin 1, spacing 2, animation 4→52, collision object and a Wang set with 46 tiles. The single tile has no Wang ID because Tiled does not store a center.

**Browser** (Chromium via Playwright, separate data folder): creating a tileset in the dialog; key tiles marked; “Complete template” yields 47 labeled tiles and a complete test map; tile tool and saving name, class and collision; the terrain widget produces “1 of 47 combinations missing”; eight ghost tiles and a stroke across the right edge that continues on the left; ½ offset only within the selected tile; Tiled and Godot download with extrude; canvas extended by one tile column, metadata follows. No page or console errors.

**Not verified:** import into Tiled itself (only via the parser), Unity import of the manifest and a real agent task for a tileset.

## Addendum: Editor basics

On 17 October 2026, **197 tests in 13 files**, the TypeScript check and the production build passed. New tests cover selection masks in the engine scope, outline, polygon and palette options, `merge_layers`, `resize_canvas` (including asset size, restore and MCP), scaled PNG/sheet exports, palette files and the editor helpers for selection, clipboard, brush, patterns and shading.

**Browser** (Chromium via Playwright, separate service with its own data folder): a 3 px brush paints 3×3, a round eraser clears a plus; filled rectangle with checkerboard pattern; polygon via Enter; magic wand plus `Del`; lasso limits the fill bucket; moving a freeform selection; `Ctrl+A`, `Ctrl+C`, `Ctrl+Shift+V` as a pixel-identical new layer; merging; shading; secondary color via right-click and `X`; outline; replace color; canvas to 20×16 and “Crop to content”; PNG export 4×; GPL export; HEX import with “Map pixels”; reference image; an external PNG from the system clipboard (two new colors appended, centered, approximated when the palette is full). No page or console errors.

**Not verified:** clipboard in Firefox and Safari, import of the scaled sheet JSON into an engine and a real agent task with the new operations.

## Addendum: AI efficiency and animation

Implemented according to the [implementation plan](animation-plan.md). On 17 October 2026, **164 tests in 10 files**, the TypeScript check and the production build passed. Newly verified, among others: lossless `rows`/`read_pixels`, frames with scope proof, Pixelorama tag rules, old documents/replays/bundles as a single frame, sheet inspection with onion and frame coverage for `completed`, sheet/Aseprite/Unity/GIF export and sheet re-import.

**Measurement via MCP** (in-memory server, 32×32 sprite, characters including the text and `structuredContent` copy):

| Call | before | after |
| --- | ---: | ---: |
| `apply_operations` response | 3,310 | 1,334 (compact), 3,920 with `response: "full"` |
| Read whole layer | 7,590 (`get_asset` `includePixels`) | 3,394 (`read_pixels`) |
| Read 8×8 region | not possible | 1,282 |
| Write 32×32 block | 2,232 (`patch`) | 1,171 (`rows`) |
| `tools/list` (once per session) | 23,512 | 32,318 |
| `get_workflow` (once per task) | 24,475 | 32,732 |

The running cost per batch drops significantly; the fixed context grows due to frame operations and the animation part of the skill. Tokens were not measured with a real tokenizer.

**Storage:** An asset with 8 frames × 4 layers × 32×32 takes about 69 KB of JSON per revision. The replay table stored every response including the document a second time (about 141 KB of database per revision). New replay entries contain only the revision ID and diff (about 73 KB per revision); old entries stay readable. Further compaction of the cels or linked cels are not needed at this scale and remain open.

**GIF:** The custom GIF89a encoder was additionally checked with the independent decoder of Pillow 12.3 (two frames, including 10,800 random indices with a table reset): indices, duration, transparency and loop match.

**Browser** (Chromium via Playwright, separate service on port 4318 with its own database): duplicating a frame, drawing with the pencil only in frame 2 (frame 1 byte-identical), setting the duration to 250 ms, onion skin via `Shift+O`, creating the tag `bounce` (ping-pong) in the dialog, playback via `K` with changing frames in the preview and stop, frame navigation with `,`, undo of the tag, an external agent change to frame 2 with the notice “Asset updated externally”, deleting a frame, importing a PNG strip as a 3-frame animation and GIF link. No page errors; the console only reported the missing `favicon.ico`.

**Not verified:** A real Codex or Claude animation task (tasks 21–23 of the [acceptance matrix](testing.md)) and the import of Aseprite JSON and Unity metadata into a real engine. The animation sources linked in the Artist Guide (Saint11, Wikipedia) could not be retrieved from the test environment because of the network policy; their claims are backed by search results.

## Addendum: Pixelorama drawing aids

On 17 October 2026, **101 tests in 7 files** ran successfully; the TypeScript check and production build pass. New regression tests cover drawing symmetry, pixel-perfect, the fill reference across visible layers, global color areas, layer duplicates and their REST/MCP/project import behavior.

The browser check ran with a separate in-memory database on port 4318. Filling based on two visible outlines wrote exactly **84 pixels** to the separate color layer; the **56 outline pixels**, the outside area and the inner area were preserved. Duplicating created an identical layer directly above the source; undo and redo worked. A pencil click with both symmetry axes wrote exactly four corner pixels to the duplicate and left the source unchanged. The tiled preview contained nine cells; at 4×, 16×16 rasters were shown at exactly 64×64 CSS pixels, with a light background and a scroll area. This spot check assesses usability, not artistic quality.

The regular service on port 4317 was then started with the new code. All **13 projects and 48 assets** had identical metadata and head revision IDs after the restart; the test instance did not write to their database.

## Automated checks from the initial acceptance

`npm test`: **74 tests passed** (engine 24, PNG/Unity 13, storage 13, HTTP/MCP 15, stdio 1, navigation/hotkeys 8). `npm run build` including the TypeScript check passes. After the switch to npm, a clean install with `npm ci` from the `package-lock.json` was verified successfully; the versions of all 17 direct dependencies remain unchanged. The formal skill validation was checked during the initial acceptance.

Among other things, the checks cover atomic rollback including run progress, idempotency before revision conflicts, unchanged protected rasters, transparent PNGs, nearest-neighbor, project and history imports, review assignment, host/origin checks, large project imports over 16 MB, invalid JSON-RPC envelopes and shutting down the service while the editor is open.

## Real Codex run

Codex CLI **0.163.0** was connected to the running service via Streamable HTTP. The application did not start an agent; the CLI was invoked outside the app for the acceptance test.

- A 32×32 skeleton was created with separate body/equipment layers, inspected as an actual MCP PNG, corrected and exported. The run took 79 seconds.
- In the subsequent precision edit, the sword became exactly three raster pixels longer. The independent comparison found **11 changed pixels, zero outside the allowed area**. All other layers were identical. The decoded PNG matches the engine raster exactly; the Unity pivot is correctly normalized.
- Nine more real assets were created: goblin, knight, slime, robot, boss skeleton, sword, potion, key and shield. The sample covers 16–64 pixels, four style profiles and a reference inspection for sword/shield.
- All ten assets were viewed as images independently of the drawing client. Goblin, slime and potion then received targeted rework on the face or bottle shape, respectively. The palettes were preserved; the other goblin layers and the slime body remained unchanged.
- The results are recognizable, simple game assets. Detail quality and style fidelity vary; this does not prove professional artistic quality for arbitrary tasks. The original full acceptance by a human remains a separate assessment.

The local test artifacts and exact IDs are in the ignored folder `artifacts/`. After an actual service restart, all **8 projects, 11 assets and 46 revisions**, including documents, history and reviews, were identical. One of the assets belongs to the manual editor test.

## Browser

Verified in a real browser: creating a project/asset, pencil, rectangle, fill, selection, moving and copying, hex palette, creating/renaming/locking/unlocking layers, undo/redo, history preview/restore, reloading and changes by agents. The browser console was free of errors. The direct link with `?project=<id>` opens the requested project; the narrow browser viewport stays usable.

PNG/project import and variants are verified by backend tests; the corresponding browser file dialogs were not additionally checked by hand.

The navigation extension was verified in the browser with the hand tool and dragging, zoom at pointer, actual size (`1`), fit (`F`), grid (`Shift+G`), the keyboard shortcuts overview (`?`) and normal text input. Tool/zoom shortcuts stay inactive in the dialog. The revision and SHA-256 of the full document were identical afterwards. The console reported no warnings or errors. Touch pinch was not implemented.

In addition, a temporary service with an in-memory database was used for a browser regression run: after a stroke, `Ctrl+Z` and `Ctrl+Shift+Z` in the historical preview made no change to the current raster or the three revisions. Back in the current state, undo and redo worked. The test service was then shut down. After closing the help, focus returns to the button that opened it.

The [researched Artist Guide](../skills/pixel-artist/references/artist-guide.md) is delivered consistently via the workflow tool, the MCP resource and new/resumed runs; this is verified by an integration test. The newly started real service also delivers the same guide via tool and resource. The image inspection now includes the stored asset style. An additional full Codex/Claude artist run with these new rules was not performed.

## Bug check after the navigation extension

Another browser run with a separate in-memory database confirms:

- The previously reproduced crash when switching from a large historical palette to the current smaller palette is fixed. A valid color stays selected.
- In the version preview, the color count and check notes refer to the displayed revision.
- A history response delayed by 2.5 seconds does not overwrite the new asset's history after an asset switch.
- External changes that arrive during a save response delayed by five seconds are loaded afterwards. Both the local and the external pixel change are preserved; outdated undo entries are discarded.
- After the event connection drops, a revision saved during the disconnect also appears automatically after reconnecting.

New automated regression tests check fully transparent PNGs with a locked project palette and repeated/invalid search parameters. The copied agent task uses the stored asset style and the actual server address (in Vite development mode, the configured backend port 4317). File and clipboard dialogs were not fully checked in this run.

## Pending acceptance

Claude Code **2.1.302** reported the Pixelator MCP server as connected. The actual artist run was rejected by the Claude account's weekly limit before the first generation. Claude's image understanding and artistic results have therefore not yet been accepted. The ten-part Codex test does not replace this second client test.

Asset packs are part of the next expansion; tilesets, animations and sprite sheets have been available since the addenda above. Project imports are limited to 128 MB in V1; larger histories currently require a database backup.
