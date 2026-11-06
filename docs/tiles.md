# Tiles

A **tileset** is an asset with a tile grid. The canvas is a multiple of the tile size; tile IDs count row by row from 0. Frames animate all tiles together.

## Creating and editing

- **New asset → Tileset:** tile size (8–32 px) plus columns × rows. 8 × 6 tiles are enough for a blob autotile. Existing assets get a grid in the *Tiles* section.
- **Select tile** (`T`): selects the tile under the pointer and limits drawing to it. In the *Tiles* section you can set name, class, probability, collision (none, solid, halves or custom rectangle) and terrain. The status bar shows the tile ID under the pointer.
- **Terrain widget:** The 3 × 3 cells are the eight neighbor positions plus the center. A click switches to the next terrain, a right-click to the previous one. The mode determines the usable cells: *Blob* reads corners and edges, *Edges* only the sides, *Corners* only the corners.
- **Seamless drawing** (toolbar): pencil, eraser, shade, line, shapes and polygon continue across the edge on the opposite side. The surroundings show the repetition. **⇲ ½** offsets the selection, the selected tile or the canvas by half its size with wraparound, so seams move to the center.
- **Canvas size:** With a tile grid, size, anchoring and cropping move whole tiles; the metadata moves with them.

## Autotiles

1. Under *Autotile template*, choose the template and start tile. The key tiles appear marked on the canvas.
2. Draw the key tiles: **Single** (freestanding), **Horizontal** (connected left and right), **Vertical** (connected top and bottom), **Cross** (all four sides with inner corners) and **Fill**. The Edges template only needs the first four.
3. **Complete template:** Each quarter of the remaining tiles is copied from the matching quarter of a key tile, as with RPG Maker autotiles. All tiles get terrain labels. The canvas grows if needed.

| Template | Terrain mode | Tiles | Use |
| --- | --- | --- | --- |
| Blob | Corners and edges | 47 | Walls, islands, platforms with inner corners |
| Edges | Edges | 16 | Paths, fences, pipes |
| Corners | Corners | 5 keys + 15 | Grass/dirt transitions, shorelines |

After corrections to the key tiles, complete the template again. An even tile size is required.

## Test map

The test map paints a sample shape with the labeled tiles, like a terrain brush in Tiled or Godot. A click toggles a cell (a corner for corner sets), `Alt`+click selects the tile used. Magenta marks combinations without a tile; the header counts all missing combinations for the mode. Agents see the same map via `inspect_asset` with `preview: "terrain"`.

## Export

| Format | Contents |
| --- | --- |
| Tileset PNG | All tiles at their grid position. Animated tiles sit below as additional row blocks (ID + frame × tiles per frame). |
| Tiled `.tsx` / `.tsj` | Tile size, margin and spacing, class, name as a property, collision as an object group, animations, terrain as a Wang set (`corner`, `edge`, `mixed`). |
| Godot `.tres` | TileSet with atlas, terrain set (mode 0/1/2) and peering bits, physics polygons, custom data (`name`, `type`), probability and animations. |
| Unity | Import manifest: one sprite per tile at one unit per tile, animated tiles, names and collision. |

Export via “Export tileset …” in the Tiles section or `Ctrl+S`: the export window previews the tileset image and the description files, with selectable targets, extrude and spacing.

**Extrude edges** (extrude) copies the edge pixels of each tile outward and prevents color fringes when engines filter the image. Image and description belong in the same folder because the description references the image by file name; Godot resolves the relative path next to the `.tres`. The single tile of the blob set has no Wang ID in Tiled because Tiled does not store a center; Godot uses it via the center terrain.

Pixelator creates tilesets, but not level maps. Level design stays in Tiled, LDtk or the engine. Background and sources: [research report](<../reports/Tiles for Pixelator.md>).
