# MCP verbinden

Pixelator muss mit `npm start` laufen; der MCP-Server muss eingeschaltet sein.

## Codex und Claude Code

```powershell
# Codex
codex mcp add pixelator --url http://127.0.0.1:4317/mcp

# Claude Code
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

## Antigravity

Für dieses Repository ist die [Workspace-Konfiguration](../.agents/mcp_config.json) vorhanden. Für andere Workspaces unter **MCP Servers → Manage MCP Servers → View raw config** diesen Eintrag zu den vorhandenen `mcpServers` hinzufügen:

```json
{
  "mcpServers": {
    "pixelator": {
      "serverUrl": "http://127.0.0.1:4317/mcp"
    }
  }
}
```

Vorhandene Server beibehalten und **Refresh** ausführen. Siehe [Antigravity-MCP-Dokumentation](https://antigravity.google/docs/mcp).

## Werkzeuge für Agenten

- `rows` (Operation) und `read_pixels`: Raster kompakt als Zeichenzeilen schreiben und lesen (`.` transparent, `1`–`9`, `a`–`w` = Palettenindex 1–32).
- `inspect_asset` mit `scales: [1, 8]`: native und vergrößerte Ansicht in einem Aufruf; Animationen als ein Sprite-Sheet, optional mit `onion`.
- `apply_operations` antwortet kompakt (neue `revisionId`, Diff, Validierung); `response: "full"` liefert die vollständige Zusammenfassung.
- Animation: `create_asset` mit `frames`/`animationTags`; Operationen `add_frame`, `duplicate_frame`, `remove_frame`, `reorder_frames`, `frame_duration`, `set_tags`, `stamp`; `editScope.frameIds` und `allowFrameChanges`.
- Bearbeitung: `editScope.mask` (Zeilen aus `#`/`.` im `rect`) begrenzt Schreibzugriffe auf eine Freiform; `merge_layers`, `resize_canvas` (mit `offsetX`/`offsetY`, negativ schneidet zu), `outline` mit `rect`/`reference`/`corners`, `polygon` mit `filled`, `palette` mit `remap: "nearest"`.
- `export_asset`: `png` (ein Frame), `json`, `unity`, `sheet` (PNG plus Aseprite-kompatibles JSON), `gif` (optional `tag`); `scale` vergrößert PNG, Sheet und GIF.
- Tiles: `create_asset` mit `type: "tileset"`, `tileWidth`, `tileHeight`; Operationen `tileset`, `tile_properties`, `autotile`, `shift`, `remove_tileset`; `inspect_asset` mit `preview: "tiles" | "wrap" | "terrain"`; `export_asset` mit `tiled`, `godot`, `unity` und `extrude`/`spacing`. Details: [Tiles](tiles.md).

Nach der Einrichtung die MCP-Verbindung im Client neu laden. Vor Zeichenaufträgen `get_workflow` aufrufen; es liefert den [Pixel-Artist-Skill](../skills/pixel-artist/SKILL.md) und den Artist Guide.
