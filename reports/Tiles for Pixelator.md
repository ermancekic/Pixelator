# Tiles: what games need and what Pixelator adds for them

Games build levels from reusable tiles. For that, a pixel editor has to do three things: **create tilesets on a fixed grid, complete the transitions between areas (autotiles) without manual work, and export the result with its metadata so that Tiled and engines understand it directly.** Before this addition, Pixelator could only repeat a single image in a 3×3 preview. Tile grids, tile metadata, autotiling, seamless drawing and any kind of tileset export were missing. Researched on 17 October 2026; sources below.

## What the established tools expect

**Tiled** is the common exchange format between pixel editor and engine. A tileset describes the image, tile size, `margin`, `spacing`, tile count and columns. Per tile, it adds a class (`type`), properties, probability, collision shapes as an object group, and animations as a sequence of `tileid` and `duration` in milliseconds ([JSON format][tiled-json], [TMX format][tiled-tmx]).

Since version 1.5, Tiled describes transitions as **Wang sets** of type `corner`, `edge` or `mixed`. Each tile gets a Wang ID of eight values in the order top, top right, right, bottom right, bottom, bottom left, left, top left; 0 means “not set” ([TMX format][tiled-tmx]). According to the manual, a complete corner or edge set with two terrains has 16 tiles. A mixed set would have 256, but can be reduced to the 47-tile blob tileset ([terrain manual][tiled-terrain]). In maps, the highest bits of the tile ID encode flips and rotation ([Global Tile IDs][tiled-gids]).

**Godot 4** stores a TileSet with an atlas, margins (`margins`), spacing (`separation`) and tile size. Terrain sets have the modes “Match Corners and Sides”, “Match Corners” and “Match Sides” (0/1/2) ([TileSet][godot-tileset], [TileSetAtlasSource][godot-atlas]). Each tile carries a center terrain and peering bits to its neighbors, plus physics polygons, custom data and probability ([TileData][godot-tiledata]).

We looked up the keys of the text format in the Godot 4.3 source code ([tile_set.cpp][godot-source]):
- Peering bits are named `terrains_peering_bit/right_side` etc.
- Collision is stored under `physics_layer_0/polygon_0/points`.
- Frame *k* of an animation is located at `coordinate + (size + animation_separation) × (k mod columns, k div columns)`.

Godot resolves relative texture paths next to the `.tres` file ([resource_format_text.cpp][godot-loader]).

**Aseprite** and **Pixelorama** offer tilemap layers: each grid cell refers to a tile of a tileset, and index 0 is empty ([Aseprite: Tilemap][aseprite-tilemap], [Pixelorama 1.1][pixelorama-11]). Aseprite also has a **Tiled Mode** that repeats the image while drawing and thus enables seamless patterns ([Aseprite: Tiled Mode][aseprite-tiled-mode]).

**Autotiling** checks a cell's neighbors, builds a bitmask from them and looks up the matching tile. In the blob method, a corner only counts if both adjacent sides are filled; this turns 256 combinations into 47. A pure four-neighbor set with 16 tiles cannot show clean inner corners (search results on [Red Blob Games][redblob] and [Excalibur][excalibur]).

## What Pixelator adopts

**Tileset as a document property instead of a new layer type.** An optional tile grid with a terrain set and tile metadata is attached to the existing document. This keeps revisions, scope rules, layers, frames and MCP usable without changes; frames animate the tiles. Tile IDs follow the grid, so resizing only moves whole tiles and carries their metadata along.

**Terrain labels in Tiled format plus center.** The eight Wang positions are adopted verbatim; a ninth value stores the center terrain, which Godot requires and Tiled does not know. This allows both formats to be generated without loss.

**Autotiles from five key tiles.** Instead of drawing 47 tiles by hand, all blob, edge and corner tiles are generated from the quarters of five key tiles (single, horizontal, vertical, cross, fill), as with RPG Maker autotiles and Aseprite's AutoBlob extension. Corner sets are sampled with a half-tile offset, because their terrain boundaries run through the tile center. The generated tiles are labeled right away.

**Testing like the engine does.** The terrain test map picks tiles with the same rule as a terrain brush and shows missing combinations in magenta. Validation warns as long as combinations are missing. Agents receive the same map, a grid view and a 3×3 repetition as real images via MCP.

**Seamless drawing.** Like Aseprite's Tiled Mode, strokes and shapes continue across the edge, and the surroundings show the repetition. A wrap-around offset by half the size (like an offset filter) moves seams to the center for inspection.

**Export that Tiled, Godot and Unity read directly.** Tileset PNG with optionally repeated edge pixels to prevent color bleeding, Tiled TSX/TSJ, Godot `.tres` and a Unity import manifest.

## Deliberately not adopted

**Level maps** (tilemap layers with a tile brush and map export) are a tool of their own. Tiled, LDtk and the engines already do this and read Pixelator's tilesets directly. Also still open are tile variants via flip flags, multiple terrain sets per tileset, isometric and hexagonal grids, and Unity rule tiles. These can be added on top of the data model when a concrete need arises.

## Verification

The exports were not only written against the format but also loaded in the tools themselves; results are in the [verification report](../docs/verification.md).
- Godot 4.3 loads a generated blob tileset headless with all metadata.
- Godot's own terrain algorithm (`set_cells_terrain_connect`) picks the same tile as Pixelator's test map in every cell of a test shape.
- `pytiled-parser` reads TSX and TSJ identically.

## Sources

[tiled-json]: https://github.com/mapeditor/tiled/blob/master/docs/reference/json-map-format.rst
[tiled-tmx]: https://github.com/mapeditor/tiled/blob/master/docs/reference/tmx-map-format.rst
[tiled-terrain]: https://github.com/mapeditor/tiled/blob/master/docs/manual/terrain.rst
[tiled-gids]: https://github.com/mapeditor/tiled/blob/master/docs/reference/global-tile-ids.rst
[godot-tileset]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tileset.rst
[godot-atlas]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tilesetatlassource.rst
[godot-tiledata]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tiledata.rst
[godot-source]: https://github.com/godotengine/godot/blob/4.3-stable/scene/resources/2d/tile_set.cpp
[godot-loader]: https://github.com/godotengine/godot/blob/4.3-stable/scene/resources/resource_format_text.cpp
[aseprite-tilemap]: https://github.com/aseprite/docs/blob/main/tilemap.md
[aseprite-tiled-mode]: https://github.com/aseprite/docs/blob/main/tiled-mode.md
[pixelorama-11]: https://orama-interactive.itch.io/pixelorama/devlog/913933/pixelorama-v11-is-out
[redblob]: https://www.redblobgames.com/articles/autotile/
[excalibur]: https://excaliburjs.com/blog/Autotiling%20Technique

- Tiled documentation: [JSON format][tiled-json], [TMX format][tiled-tmx], [Terrains][tiled-terrain], [Global Tile IDs][tiled-gids]
- Godot: [TileSet][godot-tileset], [TileSetAtlasSource][godot-atlas], [TileData][godot-tiledata], 4.3 source code [tile_set.cpp][godot-source] and [resource_format_text.cpp][godot-loader]
- Aseprite: [Tilemap][aseprite-tilemap], [Tiled Mode][aseprite-tiled-mode]; Pixelorama: [Devlog v1.1][pixelorama-11]
- Autotiling: [Red Blob Games][redblob], [Excalibur][excalibur]
- The websites of Tiled, Aseprite, Pixelorama, Godot, Red Blob Games and Excalibur could not be reached from the test environment because of the network policy. Tiled, Aseprite and Godot were read via their documentation and source repositories on GitHub; the Pixelorama devlog, Red Blob Games and Excalibur are backed by search results.
