# Editor

Quick reference for the editing features. The editor shows all shortcuts under `?`. [Tiles](tiles.md) describes tilesets, autotiles and seamless drawing.

## Interface

- **Menu bar** as in VS Code: File, Edit, View, Image, Layer, Animation and Help. A click opens a menu, hovering switches menus, and arrow keys, `Enter` and `Esc` operate it from the keyboard. Items show their shortcut and are grayed out when they are currently unavailable. Below 900 px width, the toolbars and the gear icon remain.
- **Settings** (`Ctrl+,`, gear icon at the top right): Language with English (default) or German, and View with Asset library (`Ctrl+B`), Properties, Timeline (`Ctrl+J`), Pixel grid and Tile grid. “Reset panel layout” restores all panel sizes. Settings apply per browser.
- **Language:** The interface is in English unless something else is selected. Server messages are in English; the German interface translates them. History entries appear in the selected language if they come from the editor or the server; agent labels stay as they were written.

## Projects

The project button at the top of the library opens the project overview. It shows all projects as cards with the most recently changed assets, the style profile, the palette, the asset count and the last change, sorted by activity. Typing searches, arrow keys switch cards, `Enter` opens. New projects and project imports also start here.

## Drawing

- **Brush:** Pencil, Eraser and Shade use 1–16 px, square or round (`<`/`>` or `[`/`]`). Pixel-Perfect only applies at 1 px.
- **Secondary color:** right-click on a palette color or `Alt` + Eyedropper; `X` swaps both colors.
- **Dithering:** Pencil, Line, Rectangle, Ellipse, Polygon and Fill support patterns (checkerboard, 12.5/25/75%, lines, diagonal). The patterns are aligned to the canvas, so strokes join seamlessly. With “Secondary color”, the gaps are filled; otherwise they stay unchanged.
- **Shade** (`S`): shifts opaque pixels one step lighter or darker, along the palette order or sorted by brightness. Transparency stays untouched; each pixel changes at most once per stroke.
- **Polygon** (`U`): Clicks set corners (at most 128); `Enter`, a double-click or a click on the starting point closes it, `Esc` cancels.
- **Outline and replace color** (Layers tab): outline with or without corners around the active layer or all visible layers. Replace swaps the active color in the layer or in all unlocked layers, optionally in all frames.

## Selection

- Rectangle (`V`), Lasso (`Q`) and Magic wand (`W`, with Contiguous/Reference as with Fill). `Shift` adds, `Alt` subtracts; `Ctrl+A` selects all, `Ctrl+D` deselects.
- Drawing, filling, outlining, replacing and deleting only act inside the selection; moving, flipping and rotating only move the selected pixels. Freeform selections are passed to the engine as a mask.

## Clipboard

- `Ctrl+C` copies the active layer, `Ctrl+Shift+C` all visible layers, `Ctrl+X` cuts. Without a selection, the whole canvas is used. The copy is also placed in the system clipboard as a PNG.
- `Ctrl+V` pastes into the active layer, `Ctrl+Shift+V` as a new layer. The target is the selection, otherwise the original position or the center. Transparent pixels overwrite nothing; the pasted content is selected and the Move tool becomes active.
- Colors are matched exactly. Missing colors are appended to an unlocked palette while there is room, otherwise replaced with the closest color. When pasting external images, pixels with alpha below 50% count as transparent.

## Canvas, layers and palette

- **Canvas size** (crop icon or click on the resolution): new size with anchoring, “Crop to selection” or “Crop to content”. Applies to all layers and frames; the pivot moves along. Locked layers prevent their pixels from being cut off.
- **Merge:** with the layer below or all visible layers. Hidden layers are kept; the image does not change.
- **Palettes:** “Load file” reads GIMP (`.gpl`), JASC (`.pal`), Lospec/Hex (`.hex`) and Paint.NET (`.txt`). “Apply palette” recolors every index, “Map pixels” sets each pixel to the closest new color. Export via “Export …” in the palette section as `.gpl`, `.hex` or `.pal`.

## Export

“Export” (`Ctrl+S`) opens the export window. The format is on the left, the settings and a preview showing exactly the file's pixels on the right; text formats appear as file contents.

| Format | Settings | Files |
| --- | --- | --- |
| Image (PNG) | Size 1–16×, frame | `.png` |
| Sprite sheet | Size, tag or all frames, columns | `.sheet.png`, optionally Aseprite `.sheet.json` |
| Animated GIF | Size, tag (with direction and loop) | `.gif` |
| Tileset | Tiled `.tsx`/`.tsj`, Godot `.tres`, Unity; extrude, spacing | `.tileset.png` and the selected descriptions |
| Unity | Tag and columns for animations | Image or sheet and `.unity.json` (for tilesets, in the tileset export) |
| Palette | GIMP, JASC, Hex | `.gpl`, `.pal`, `.hex` |
| Project file | – | `.pixelator.json` with history |

Multiple files are downloaded one after another; each file is also linked individually at the bottom. The window remembers the last settings. Sheet and GIF export need at least two frames, the tileset export needs a tile grid. Unity metadata stays at 1×.

## Preview and reference image

- The preview starts with “Fit”: the whole image fits the panel, enlarged by whole-number factors and scaled down continuously for large images. 1×, 2×, 4× and 8× show fixed pixel sizes with scrolling.
- The reference image sits either behind or above the drawing, with opacity and fit settings. It is not part of the asset, appears in no export and is stored only in this browser (larger images only for the current session).
