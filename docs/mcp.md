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

Nach der Einrichtung die MCP-Verbindung im Client neu laden. Vor Zeichenaufträgen `get_workflow` aufrufen; es liefert den [Pixel-Artist-Skill](../skills/pixel-artist/SKILL.md) und den Artist Guide.
