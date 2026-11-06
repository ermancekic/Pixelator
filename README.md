> I created this project to create 2D assets with my Claude agents.

![Pixelator – your pixel art studio](docs/assets/readme-header.gif)

# Pixelator

Local pixel art editor with MCP for Codex, Claude and Antigravity. Requires Node.js **24.13 or newer**.

## Features

- Projects and style profiles
- Layers with visibility, locking, duplicating and merging
- Pencil, eraser, eyedropper, lines, shapes and polygon
- Brush sizes, dither patterns, shading and secondary color
- Fill: contiguous or global, layer or whole image
- Rectangle, lasso and magic wand selection; move and copy
- Clipboard between assets and other programs
- Flip, rotate, outline and color replacement
- Canvas resize and crop
- Drawing symmetry and pixel-perfect pencil
- Palettes with import/export (GPL, PAL, HEX) and transparency
- Reference image for tracing
- Tilesets with tile grid, collision and terrain
- Autotiles (blob, edges, corners) from five key tiles, with a terrain test map
- Seamless drawing
- Tileset export for Tiled, Godot and Unity
- Zoom, hand tool, grids and keyboard shortcuts
- Menu bar, settings and resizable panels
- English and German interface
- Preview with fit zoom and 3×3 tiling
- Revisions, undo and redo
- Asset variants
- Animation: frames, per-frame duration, tags, onion skin and playback
- PNG, sprite sheet and project import
- Export window with live preview: PNG, sprite sheet with Aseprite JSON, GIF, tileset, Unity, palette and project file; images 1–16×
- MCP runs, image inspection, compact raster input/output and agent status

## Generated examples

[![Characters generated with Pixelator](docs/assets/examples/characters.gif)](docs/examples.md)

[More examples](docs/examples.md): enemies, bosses, effects and backgrounds. The banners at the top and bottom of this README were also made with Pixelator.

## Start

```powershell
npm install
npm run build
npm start
```

[Open the editor](http://127.0.0.1:4317). Keep the terminal open while you work.

## Connect MCP

With the app running and the MCP server switched on:

```powershell
# Codex
codex mcp add pixelator --url http://127.0.0.1:4317/mcp

# Claude Code
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

**Antigravity:** add this under **MCP Servers → Manage MCP Servers → View raw config** and keep your existing servers:

```json
{ "mcpServers": { "pixelator": { "serverUrl": "http://127.0.0.1:4317/mcp" } } }
```

Then reload the MCP connection in the client. [More details](docs/mcp.md) · [Editor](docs/editor.md) · [Tiles](docs/tiles.md) · [Tests](docs/testing.md)

Data lives in `data/`. For backups, stop the app and copy the folder.

[MIT License](LICENSE)

![Pixelator panorama](docs/assets/readme-footer.gif)
