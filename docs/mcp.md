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

## Tools for agents

- `rows` (operation) and `read_pixels`: write and read rasters compactly as character rows (`.` transparent, `1`–`9`, `a`–`w` = palette index 1–32).
- `inspect_asset` with `scales: [1, 8]`: native and enlarged view in one call; animations as one sprite sheet, optionally with `onion`.
- `apply_operations` responds compactly (new `revisionId`, diff, validation); `response: "full"` returns the full summary.
- Animation: `create_asset` with `frames`/`animationTags`; operations `add_frame`, `duplicate_frame`, `remove_frame`, `reorder_frames`, `frame_duration`, `set_tags`, `stamp`; `editScope.frameIds` and `allowFrameChanges`.
- Editing: `editScope.mask` (rows of `#`/`.` within the `rect`) limits writes to a freeform shape; `merge_layers`, `resize_canvas` (with `offsetX`/`offsetY`, negative values crop), `outline` with `rect`/`reference`/`corners`, `polygon` with `filled`, `palette` with `remap: "nearest"`.
- `export_asset`: `png` (one frame), `json`, `unity`, `sheet` (PNG plus Aseprite-compatible JSON), `gif` (optional `tag`); `scale` enlarges PNG, sheet and GIF.
- Tiles: `create_asset` with `type: "tileset"`, `tileWidth`, `tileHeight`; operations `tileset`, `tile_properties`, `autotile`, `shift`, `remove_tileset`; `inspect_asset` with `preview: "tiles" | "wrap" | "terrain"`; `export_asset` with `tiled`, `godot`, `unity` and `extrude`/`spacing`. Details: [Tiles](tiles.md).

After setup, reload the MCP connection in the client. Call `get_workflow` before drawing tasks; it returns the [Pixel Artist skill](../skills/pixel-artist/SKILL.md) and the Artist Guide.
