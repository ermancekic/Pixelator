# Pixelator

Lokaler Pixel-Art-Editor mit MCP für Codex, Claude und Antigravity. Benötigt Node.js **ab 24.13**.

## Features

- Projekte und Stilprofile
- Ebenen mit Sichtbarkeit, Sperren und Duplikaten
- Stift, Radierer, Pipette, Linien und Formen
- Füllen: zusammenhängend/global, Ebene/Gesamtbild
- Auswahl, Verschieben und Kopieren
- Spiegeln und Drehen
- Zeichensymmetrie und Pixel-Perfect-Stift
- Paletten und Transparenz
- Zoom, Handwerkzeug, Raster und Tastenkürzel
- Vorschau mit 3×3-Kachelung
- Revisionen, Rückgängig und Wiederholen
- Asset-Varianten
- Animation: Frames, Dauer pro Frame, Tags, Onion Skin und Wiedergabe
- PNG-, Sprite-Sheet- und Projektimport
- PNG-/JSON-Export, Sprite-Sheet mit Aseprite-JSON, GIF und Unity-Metadaten mit Pivot
- MCP-Aufträge, Bildinspektion, kompakte Rasterein-/ausgabe und Agentenstatus

## Start

```powershell
npm install
npm run build
npm start
```

[Editor öffnen](http://127.0.0.1:4317). Das Terminal während der Nutzung geöffnet lassen.

## MCP verbinden

Bei laufender App und eingeschaltetem MCP-Server:

```powershell
# Codex
codex mcp add pixelator --url http://127.0.0.1:4317/mcp

# Claude Code
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

**Antigravity:** Unter **MCP Servers → Manage MCP Servers → View raw config** ergänzen; vorhandene Server beibehalten:

```json
{ "mcpServers": { "pixelator": { "serverUrl": "http://127.0.0.1:4317/mcp" } } }
```

Danach die MCP-Verbindung im Client neu laden. [Weitere Details](docs/mcp.md) · [Tests](docs/testing.md)

Daten liegen in `data/`. Für Backups die App beenden und den Ordner sichern.
