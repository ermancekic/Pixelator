# Pixelator

Lokaler Pixel-Art-Editor mit Ebenen, Revisionen und PNG-/Unity-Export. Codex oder Claude können dieselben Assets über MCP bearbeiten; die App enthält kein eigenes KI-Modell.

## Start

Node.js **ab 24.13** erforderlich. Im Repository ausführen:

```powershell
npm install
npm run build
npm start
```

[Editor öffnen](http://127.0.0.1:4317). Das Terminal während der Nutzung geöffnet lassen.

## Agent verbinden (optional)

Bei laufender App den passenden Befehl ausführen:

```powershell
# Codex
codex mcp add pixelator --url http://127.0.0.1:4317/mcp

# Claude Code
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

Danach die MCP-Verbindung im Client neu laden. Für Zeichenaufträge den [Pixel-Artist-Skill](skills/pixel-artist/SKILL.md) verwenden.

## Daten und Entwicklung

Daten liegen in `data/pixelator.sqlite`. Für ein Backup die App beenden und den gesamten Ordner `data/` sichern. Das Löschen von Assets und Projekten ist endgültig.

Prüfungen: `npm test` und `npm run typecheck`. Weitere Details: [Testdokumentation](docs/testing.md).
