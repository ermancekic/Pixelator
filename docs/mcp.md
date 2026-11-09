# Connect MCP

Pixelator must be running via `npm start`; the MCP server must be switched on.

## Codex and Claude Code

```powershell
# Codex
codex mcp add pixelator --url http://127.0.0.1:4317/mcp

# Claude Code
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

## Antigravity

This repository includes the [workspace configuration](../.agents/mcp_config.json). For other workspaces, add this entry to the existing `mcpServers` under **MCP Servers → Manage MCP Servers → View raw config**:

```json
{
  "mcpServers": {
    "pixelator": {
      "serverUrl": "http://127.0.0.1:4317/mcp"
    }
  }
}
```

Keep existing servers and run **Refresh**. See the [Antigravity MCP documentation](https://antigravity.google/docs/mcp).

## Stdio bridge

For clients that only start local commands, or that lose the HTTP session after a Pixelator restart or five idle minutes, connect through the bridge instead. It forwards stdio to the running service and opens a new session on its own. Pixelator must still be running.

```powershell
# Claude Code
claude mcp add --scope user pixelator -- cmd /c npm --prefix C:\path\to\Pixelator run -s mcp:stdio

# Codex
codex mcp add pixelator -- cmd /c npm --prefix C:\path\to\Pixelator run -s mcp:stdio
```

On macOS and Linux leave out `cmd /c`. `-s` keeps npm's own output off the protocol stream. `PIXELATOR_URL` changes the service address (local addresses only).

## Tools for agents

- `rows` (operation) and `read_pixels`: write and read rasters compactly as character rows (`.` transparent, `1`–`9`, `a`–`w` = palette index 1–32). The legend shows each color with its role name.
- `inspect_asset` with `scales: [1, 8]`: native and enlarged view in one call; animations as one sprite sheet, optionally with `onion`. `background: "#RRGGBB"` paints the game background under transparent pixels, because clients otherwise show transparency as white or black.
- Inspection aids: `rect` zooms into a region, `layerIds` isolates layers, `grid` adds a coordinate grid with numbered rulers, `background: "checker"` shows where the sprite is transparent, `mode: "silhouette" | "values"` shows shape or brightness only. The response notes images above about 1568 px on the long edge, which many vision clients shrink.
- Colors: an asset keeps the color budget it was created with (the preset's palette size, at most 32). Set `maxColors` in `create_asset` or the project style, or raise it later with the `palette` operation's `maxColors`.
- `import_png` brings an existing PNG or sprite sheet in as an asset, from a local `path` or `pngBase64`; `update_asset` renames and retags; `list_runs` finds interrupted runs for `resume_run`.
- `inspect_assets`: several assets side by side in one image (`assetIds`, or `projectId` with `q`/`type`), numbered and on a shared background. The same sheet for a whole project: `GET /api/projects/<id>/contact-sheet?scale=4&background=%23808080`.
- `apply_operations` responds compactly (new `revisionId`, diff, validation); `response: "full"` returns the full summary. A rejected batch names the failing entry (`operations[i]`, `operationIndex`) with the offending row or coordinate. The tool schema describes every operation.
- Animation: `create_asset` with `frames`/`animationTags`; operations `add_frame`, `duplicate_frame`, `remove_frame`, `reorder_frames`, `frame_duration`, `set_tags`, `stamp`; `editScope.frameIds` and `allowFrameChanges`. A drawing operation reaches several frames with `frameIds: [...]` or all frames in scope with `frameIds: "all"`.
- Editing: `editScope.mask` (rows of `#`/`.` within the `rect`) limits writes to a freeform shape; `merge_layers`, `resize_canvas` (with `offsetX`/`offsetY`, negative values crop), `outline` with `rect`/`reference`/`corners`, `polygon` with `filled`, `palette` with `remap: "nearest"`.
- Reuse: `stamp` with `sourceAssetId` copies a region from another asset; colors are matched by value (`colorMatch: "nearest"` approximates missing ones).
- Palette roles: `palette_names` names colors and defines shading ramps without changing pixels; `palette` accepts `names`/`ramps`. Project styles carry `paletteNames` and `ramps` as defaults for new assets; the presets include them.
- Project style: `perspective` is `front`, `side`, `top-down`, `three-quarter` or `isometric`.
- Runs: `start_run` with `quality: "draft" | "standard" | "polished"` sets the review and batch budget (2/4/8 reviews, 40/120/400 batches); `get_run` shows what is used. Full inspections of one revision add up, so a long animation can be checked in several calls; `record_review` accepts `reviewer: "independent"`.
- `export_asset`: `png` (one frame), `json`, `unity` (PNG or sheet PNG plus manifest), `sheet` (PNG plus Aseprite-compatible JSON), `gif` (optional `tag`); `scale` enlarges PNG, sheet and GIF. `outputDir` (absolute path) writes stable file names straight into the game folder, optionally named by `fileName`; `pixelsPerUnit` sets the Unity value, ideally one value (the tile size) for all assets.
- Tiles: `create_asset` with `type: "tileset"`, `tileWidth`, `tileHeight`; operations `tileset`, `tile_properties`, `autotile`, `shift`, `remove_tileset`; `inspect_asset` with `preview: "tiles" | "wrap" | "terrain"` (`wrap` with `rect` repeats one tile); `export_asset` with `tiled`, `godot`, `unity` and `extrude`/`spacing`. Details: [Tiles](tiles.md).

After setup, reload the MCP connection in the client. Call `get_workflow` before drawing tasks; it returns the [Pixel Artist skill](../skills/pixel-artist/SKILL.md) and the Artist Guide. To check whether a change makes agents draw better, see [Comparing asset quality](benchmark.md).
