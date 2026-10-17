# Pixelator

Pixelator ist ein lokaler Pixel-Editor mit einer headless Raster-Engine und MCP-Schnittstelle. Ein bereits vorhandener Codex- oder Claude-Agent übernimmt die Rolle des Pixel Artists: planen, zeichnen, das echte Bild ansehen, gezielt korrigieren und speichern. Menschen bearbeiten dieselben Assets im Browser.

Die App enthält kein KI-Modell und startet keinen Agenten. Sie benötigt weder eigene API-Schlüssel noch Ollama. Die Modellwahl und mögliche Modellkosten liegen beim verwendeten Agenten-Client; dessen Verarbeitung kann je nach Einrichtung in der Cloud erfolgen.

## Lokal starten

Voraussetzungen: Node.js ab **24.13** und npm (wird mit Node.js installiert). Im Repository ausführen:

```powershell
npm install
npm run build
npm start
```

Der Prozess bleibt während der Nutzung geöffnet. Anschließend den [Editor](http://127.0.0.1:4317) öffnen. Der [Health-Endpunkt](http://127.0.0.1:4317/api/health) prüft, ob der Service erreichbar ist.

Oben rechts öffnet die MCP-Anzeige ein kleines Statusfenster mit Serverstatus, Editor-Verbindung, Laufzeit, aktiven und gesamten Anfragen, Tool-Anfragen und Endpunkt. **Start** und **Stopp** steuern die MCP-Schnittstelle; der Editor bleibt erreichbar. Stopp blockiert neue MCP-Anfragen, laufende werden abgeschlossen. Der anfragebasierte MCP-Transport meldet Aktivität statt einer dauerhaften Agenten-Verbindung. Beim App-Neustart startet MCP wieder automatisch und die Zähler beginnen bei null.

Die Anwendung speichert Projekte und Revisionen standardmäßig in `data/pixelator.sqlite` im Repository. Mit `PIXELATOR_DATA_DIR` lässt sich ein anderes Datenverzeichnis wählen. Vor einem Backup den Service beenden und das ganze Datenverzeichnis sichern. Installation und Paketdownload benötigen zunächst Netzwerkzugriff; für die Raster-Engine ist kein externer Dienst nötig. Den Service auf dem lokalen Rechner betreiben, nicht öffentlich ins Netz stellen.

Projektdateien lassen sich bis 128 MB importieren; reguläre API-Anfragen sind auf 16 MB begrenzt. Sehr große Historien über das Datenbank-Backup sichern. Node.js 24 kennzeichnet seine eingebaute SQLite-Schnittstelle noch als experimentell; die App benötigt dadurch kein zusätzliches natives Datenbankpaket.

## Bestehenden Agenten verbinden

Der gemeinsame MCP-Endpunkt lautet `http://127.0.0.1:4317/mcp`. Der Pixelator-Service muss bereits laufen. Die folgenden Befehle sind **manuelle Einrichtungsschritte** für den gewünschten Client; Pixelator verändert dessen Konfiguration nicht selbst.

Codex:

```powershell
codex mcp add pixelator --url http://127.0.0.1:4317/mcp
```

Claude Code:

```powershell
claude mcp add --transport http pixelator http://127.0.0.1:4317/mcp --scope user
```

Die verfügbaren Tools müssen im jeweiligen Agenten-Client erscheinen. Bei einer bereits offenen Sitzung die Verbindung dort neu laden oder eine neue Sitzung starten. Der Client muss die PNG-Bildantwort von `inspect_asset` tatsächlich an sein visuelles Modell weitergeben können. Ein sichtbarer Toolname allein weist das nicht nach.

Für Clients, die einen stdio-Transport benötigen, gibt es zusätzlich:

```powershell
node --import tsx src/stdio.ts
```

Dieser Prozess ist eine HTTP-Bridge und benötigt ebenfalls den laufenden Service. Den Befehl im Repository-Verzeichnis als stdio-Server konfigurieren; er startet keine zweite Engine und keinen KI-Agenten. Der direkte Node-Aufruf hält Paketmanager-Ausgaben aus dem JSON-RPC-Protokoll heraus.

## Pixel-Artist-Skill installieren

Die portable Skill liegt in [skills/pixel-artist/SKILL.md](skills/pixel-artist/SKILL.md). Sie führt den externen Agenten durch Zeichnen, echte Bildinspektion, Kritik und höchstens drei Korrekturrunden.

Der [Artist Guide mit Quellen](skills/pixel-artist/references/artist-guide.md) ergänzt die Regeln für Silhouette, Farbflächen, Palette/Kontrast, Licht, Kanten und Lesbarkeit im Spiel. Grundlage sind die Leitfäden von Pedro Medeiros / Saint11, Derek Yu und cure. Die Empfehlungen berücksichtigen den gespeicherten Stil und ausdrücklich gewünschte Ausnahmen.

Der MCP-Server verlangt vor jedem Artist-Auftrag `get_workflow` und liefert den aktuellen Guide auch bei `start_run` und `resume_run` sowie als Ressource `pixelator://artist-guide`. Der kopierte Browser-Auftrag enthält ebenfalls den Pflichtabruf. Der Guide wird aus dem Repository geladen, sodass ein älterer lokal installierter Skill den aktuellen Serverleitfaden abrufen kann. Nach Regeländerungen den Pixelator-Service und die MCP-Verbindung neu laden.

Die visuelle Prüfung verlangt das echte Bild in Originalgröße und vergrößert sowie konkrete Beobachtungen zu Lesbarkeit, Clustern/Kanten, Palette/Licht, Stil und präziser Umsetzung. Der Server prüft weiterhin Revision, technische Gültigkeit und erfolgtes Review; ob ein externes Modell die ästhetischen Regeln versteht und befolgt, bleibt eine visuelle Bewertung.

Den Ordner `skills/pixel-artist` bei Bedarf selbst in das persönliche Skill-Verzeichnis kopieren:

| Client | Zielordner unter Windows |
| --- | --- |
| Codex | `%USERPROFILE%\.agents\skills\pixel-artist\` |
| Claude Code | `%USERPROFILE%\.claude\skills\pixel-artist\` |

Danach muss dort jeweils direkt die Datei `SKILL.md` liegen. Unter macOS/Linux entsprechen die Ziele `~/.agents/skills/pixel-artist/` und `~/.claude/skills/pixel-artist/`. Vorhandene Skills vor dem Ersetzen vergleichen. Die Skill anschließend im Client neu laden oder in einer neuen Sitzung verwenden. Diese Installation geschieht bewusst durch den Nutzer; das Repository kopiert nichts in persönliche Konfigurationen.

Erster Auftrag an den verbundenen Agenten:

```text
Nutze die Skill pixel-artist und die Pixelator-MCP-Tools.
Erstelle ein Projekt „Dark Fantasy“ und darin einen 32×32 Skeleton Warrior
in Side-View mit Schwert, transparenter Fläche und höchstens 16 sichtbaren Farben.
Zeichne Körper und Schwert auf getrennte benannte Ebenen.
Sieh dir das echte Bild an, korrigiere konkrete Probleme und speichere das Ergebnis.
```

Danach etwa:

```text
Verlängere bei diesem Asset nur das Schwert um 3 Pixel.
Bewahre alle Pixel außerhalb des betroffenen Schwertbereichs.
Sieh dir die neue Revision an und exportiere sie als PNG für Unity.
```

Ein Tool zum Anlegen eines Assets erzeugt zunächst eine Leinwand. Erst die Zeichenoperationen des Agenten erstellen das Motiv. Ein Prompt in der Browser-App startet keinen externen Agenten.

## Zeichenfläche und Hotkeys

Die Ansicht lässt sich unabhängig von den Asset-Pixeln verschieben und zoomen. Das Mausrad zoomt zum Mauszeiger; die Darstellung verwendet ganze Zoomstufen von 100–2400 %. Der Zoomwert in der Werkzeugleiste passt das Bild wieder ein.

| Aktion | Bedienung |
| --- | --- |
| Ansicht verschieben | Leertaste + Ziehen, mittlere Maustaste oder Handwerkzeug `H` |
| Vergrößern / verkleinern | Mausrad oder `+` / `−` |
| Einpassen und zentrieren | `F` oder `0` |
| Originalgröße | `1` |
| Pixelraster | `Umschalt+G` |
| Stift / Radierer / Füllen / Pipette | `P` / `E` / `G` / `I` |
| Linie / Rechteck / Ellipse | `L` / `R` / `O` |
| Auswahl / Pixel verschieben | `V` / `M` |
| Rückgängig / wiederholen | `Strg+Z` / `Strg+Umschalt+Z` oder `Strg+Y` |
| PNG exportieren | `Strg+S` |
| Auswahl aufheben | `Esc` |
| Hotkey-Übersicht | `?` oder Hilfe-Button in der Werkzeugleiste |

Auf macOS funktioniert `Cmd` statt `Strg`. In Textfeldern und Dialogen bleiben normale Texteingabe und Browser-Tastenkürzel erhalten. Verschieben der Ansicht verändert weder Pixel noch Revisionen.

## Erster Funktionsumfang

- Einzelne Charaktere, Items, Props und UI-Assets mit 1–64 Pixeln je Dimension, üblich sind 8–64; Front- oder Seitenansicht.
- Stilvorgaben für 1-Bit, Game Boy, 8-Bit und 16-Bit, eine feste oder bearbeitbare Palette mit höchstens 32 sichtbaren Farben und echter Transparenz auf Index `0`.
- Benannte Ebenen, präzise Rasteroperationen, begrenzte Änderungsbereiche, Revisionen, Varianten und technische Validierung.
- Ein gemeinsamer Datenstand für Browser und MCP; verlustfreier PNG-Export, JSON-Dokument und Unity-Export.

Die Raster-Engine setzt ganze Pixel und verwendet keine Bildverkleinerung als Generierungsmethode. Technische Prüfungen erkennen unter anderem ungültige Größe, Palette oder Alpha-Werte. Lesbarkeit, Licht, Perspektive und künstlerische Konsistenz bleiben visuelle Bewertungen. Ein erfolgreicher Run ist kein Nachweis guter Kunst.

Animationen, Sprite-Sheets, Tilesets, acht Richtungen und vollständige Asset Packs sind spätere Ausbaustufen. Ziel eines normalen Artist-Auftrags sind höchstens zehn Minuten; Geschwindigkeit und Qualität hängen auch vom externen Agenten ab.

## Entwicklung und Prüfung

```powershell
npm run typecheck
npm test
npm run build
```

Die [Abnahmematrix](docs/testing.md) trennt automatisierte Integritätsprüfungen von echten Artist-Workflows und visueller Bewertung. Technisch gültige Raster allein belegen keine künstlerische Qualität.

Der [geprüfte Stand vom 17. Oktober 2026](docs/verification.md) enthält die tatsächlichen Testergebnisse, den Codex-Pixelvergleich und die noch offene Claude-Abnahme.
