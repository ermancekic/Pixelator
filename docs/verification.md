# Geprüfter Stand · 17. Oktober 2026

Die erste Version ist lokal implementiert und läuft mit einer gemeinsamen Raster-Engine für Browser und MCP. Diese Prüfung betrifft den Stand vom 17. Oktober 2026, keine allgemeine Garantie für jedes Motiv oder Agentenmodell.

## Ergänzung: Tiles

Am 17. Oktober 2026 bestanden **218 Tests in 15 Dateien**, TypeScript-Prüfung und Produktionsbuild. Neu getestet: Kachelraster und Metadaten-Validierung, `tileset`/`tile_properties`/`remove_tileset`, Remap bei `resize_canvas`, `shift`, Autotile-Komposition (47/16/15 Kombinationen, Viertel- und Halbversatz-Regeln), Terrain-Zuordnung mit Wahrscheinlichkeit, Testkarten-Render, Tileset-Layout mit Extrude, Tiled-/Godot-/Unity-Export, REST- und MCP-Durchlauf sowie nahtloses Zeichnen.

**Externe Werkzeuge:** Ein mit der Engine erzeugtes 16×16-Blob-Tileset (Autotile aus fünf Schlüsselkacheln, Name, Klasse, Kollision, Häufigkeit, zwei Frames, Extrude 1) wurde exportiert und mit den Originalwerkzeugen geprüft.
- **Godot 4.3** (headless, offizielles Linux-Release) lädt die `.tres` mit 47 Kacheln, Terrain-Set „Gras“ im Modus 0, Kollisionspolygon um die Kachelmitte, Custom Data, Häufigkeit 0,5 und Animation; Frame 2 liegt korrekt bei Pixel (73, 109).
- Godots eigener Terrain-Pinsel (`set_cells_terrain_connect`) wählte für eine Testform in **48 von 48 Zellen dieselbe Kachel** wie Pixelators Testkarte.
- **pytiled-parser 2.2.9** las TSX und TSJ identisch: 96 Kacheln (2 Frames), Rand 1, Abstand 2, Animation 4→52, Kollisionsobjekt und ein Wang-Set mit 46 Kacheln. Die Einzelkachel bleibt ohne Wang-ID, weil Tiled kein Zentrum speichert.

**Browser** (Chromium über Playwright, eigener Datenordner): Tileset im Dialog anlegen; Schlüsselkacheln markiert; „Vorlage vervollständigen“ ergibt 47 gelabelte Kacheln und eine vollständige Testkarte; Kachel-Werkzeug, Name, Klasse und Kollision speichern; Terrain-Widget erzeugt „1 von 47 Kombinationen fehlen“; acht Geisterkacheln und ein Strich über den rechten Rand, der links weiterläuft; Versatz ½ nur innerhalb der gewählten Kachel; Tiled- und Godot-Download mit Extrude; Leinwand um eine Kachelspalte erweitert, Metadaten folgen. Keine Seiten- oder Konsolenfehler.

**Nicht geprüft:** Import in Tiled selbst (nur über den Parser), Unity-Import des Manifests und ein realer Agentenauftrag für ein Tileset.

## Ergänzung: Editor-Grundfunktionen

Am 17. Oktober 2026 bestanden **197 Tests in 13 Dateien**, TypeScript-Prüfung und Produktionsbuild. Neue Tests decken Auswahlmasken im Engine-Scope, Kontur-, Polygon- und Palettenoptionen, `merge_layers`, `resize_canvas` (einschließlich Assetgröße, Wiederherstellen und MCP), skalierte PNG-/Sheet-Exporte, Palettendateien sowie die Editor-Helfer für Auswahl, Zwischenablage, Pinsel, Muster und Schattieren ab.

**Browser** (Chromium über Playwright, separater Dienst mit eigenem Datenordner): Pinsel 3 px malt 3×3, runder Radierer löscht ein Plus; gefülltes Rechteck mit Schachbrettmuster; Polygon per Enter; Zauberstab plus `Entf`; Lasso begrenzt den Fülleimer; Freiform verschieben; `Strg+A`, `Strg+C`, `Strg+Umschalt+V` als pixelgleiche neue Ebene; Zusammenführen; Schattieren; Zweitfarbe per Rechtsklick und `X`; Kontur; Farbe ersetzen; Leinwand auf 20×16 und „Auf Inhalt zuschneiden“; PNG-Export 4×; GPL-Export; HEX-Import mit „Pixel zuordnen“; Referenzbild; ein fremdes PNG aus der System-Zwischenablage (zwei neue Farben angehängt, mittig platziert, bei voller Palette angenähert). Keine Seiten- oder Konsolenfehler.

**Nicht geprüft:** Zwischenablage in Firefox und Safari, Import des skalierten Sheet-JSON in einer Engine und ein realer Agentenauftrag mit den neuen Operationen.

## Ergänzung: KI-Effizienz und Animation

Umgesetzt nach dem [Implementierungsplan](animation-plan.md). Am 17. Oktober 2026 bestanden **164 Tests in 10 Dateien**, TypeScript-Prüfung und Produktionsbuild. Neu geprüft sind unter anderem: `rows`/`read_pixels` verlustfrei, Frames mit Scope-Nachweis, Pixelorama-Tag-Regeln, alte Dokumente/Replays/Bundles als ein Frame, Sheet-Inspektion mit Onion und Frame-Abdeckung für `completed`, Sheet-/Aseprite-/Unity-/GIF-Export sowie Sheet-Re-Import.

**Messung über MCP** (In-Memory-Server, 32×32-Sprite, Zeichen inklusive Text- und `structuredContent`-Kopie):

| Aufruf | vorher | nachher |
| --- | ---: | ---: |
| `apply_operations`-Antwort | 3 310 | 1 334 (kompakt), 3 920 mit `response: "full"` |
| Ganze Ebene lesen | 7 590 (`get_asset` `includePixels`) | 3 394 (`read_pixels`) |
| 8×8-Ausschnitt lesen | nicht möglich | 1 282 |
| 32×32-Block schreiben | 2 232 (`patch`) | 1 171 (`rows`) |
| `tools/list` (einmal je Sitzung) | 23 512 | 32 318 |
| `get_workflow` (einmal je Auftrag) | 24 475 | 32 732 |

Die laufenden Kosten pro Batch sinken deutlich; der feste Kontext wächst durch Frame-Operationen und den Animationsteil des Skills. Token wurden nicht mit einem echten Tokenizer gemessen.

**Speicher:** Ein Asset mit 8 Frames × 4 Ebenen × 32×32 belegt rund 69 KB JSON pro Revision. Die Replay-Tabelle speicherte jede Antwort samt Dokument ein zweites Mal (rund 141 KB Datenbank pro Revision). Neue Replay-Einträge enthalten nur Revisions-ID und Diff (rund 73 KB pro Revision); alte Einträge bleiben lesbar. Eine weitere Kompaktierung der Cels oder verlinkte Cels sind bei dieser Größenordnung nicht nötig und bleiben offen.

**GIF:** Der eigene GIF89a-Encoder wurde zusätzlich mit dem unabhängigen Decoder von Pillow 12.3 geprüft (zwei Frames, darunter 10 800 Zufallsindizes mit Tabellen-Reset): Indizes, Dauer, Transparenz und Loop stimmen.

**Browser** (Chromium über Playwright, separater Dienst auf Port 4318 mit eigener Datenbank): Frame duplizieren, mit dem Stift nur in Frame 2 zeichnen (Frame 1 bytegleich), Dauer 250 ms setzen, Onion Skin per `Umschalt+O`, Tag `bounce` (Ping-Pong) im Dialog anlegen, Wiedergabe per `K` mit wechselnden Frames in der Vorschau und Stopp, Frame-Navigation mit `,`, Undo des Tags, externe Agentenänderung an Frame 2 mit Hinweis „Asset extern aktualisiert“, Frame löschen, PNG-Streifen als 3-Frame-Animation importieren und GIF-Link. Keine Seitenfehler; die Konsole meldete nur das fehlende `favicon.ico`.

**Nicht geprüft:** Ein realer Codex- oder Claude-Animationsauftrag (Aufgaben 21–23 der [Abnahmematrix](testing.md)) und der Import von Aseprite-JSON und Unity-Metadaten in einer echten Engine. Die im Artist Guide verlinkten Animationsquellen (Saint11, Wikipedia) waren aus der Prüfumgebung wegen der Netzwerkrichtlinie nicht abrufbar; ihre Aussagen sind über Suchergebnisse belegt.

## Ergänzung: Pixelorama-Zeichenhilfen

Am 17. Oktober 2026 wurden **101 Tests in 7 Dateien** erfolgreich ausgeführt; TypeScript-Prüfung und Produktionsbuild bestehen. Neue Regressionstests decken Zeichensymmetrie, Pixel-Perfect, die Füllreferenz über sichtbare Ebenen, globale Farbflächen, Ebenenduplikate und deren REST-/MCP-/Projektimport-Verhalten ab.

Die Browserprüfung lief mit einer separaten In-Memory-Datenbank auf Port 4318. Das Füllen anhand zweier sichtbarer Konturen schrieb exakt **84 Pixel** auf die getrennte Farbebene; die **56 Konturpixel**, Außenbereich und innere Fläche blieben erhalten. Duplizieren erzeugte eine identische Ebene direkt über der Quelle; Rückgängig und Wiederholen funktionierten. Ein Stiftklick mit beiden Symmetrieachsen schrieb exakt vier Eckpixel auf das Duplikat und ließ die Quelle unverändert. Die gekachelte Vorschau enthielt neun Zellen; bei 4× wurden 16×16-Raster mit exakt 64×64 CSS-Pixeln angezeigt, mit hellem Hintergrund und Scrollbereich. Diese Stichprobe bewertet die Bedienung, keine künstlerische Qualität.

Der normale Dienst auf Port 4317 wurde anschließend mit dem neuen Code gestartet. Alle **13 Projekte und 48 Assets** hatten nach dem Neustart identische Metadaten und Head-Revisions-IDs; die Testinstanz schrieb nicht in deren Datenbank.

## Automatisierte Prüfungen der Erstabnahme

`npm test`: **74 Tests bestanden** (Engine 24, PNG/Unity 13, Speicher 13, HTTP/MCP 15, stdio 1, Navigation/Hotkeys 8). `npm run build` einschließlich TypeScript-Prüfung besteht. Nach der Umstellung auf npm wurde eine saubere Installation mit `npm ci` aus der `package-lock.json` erfolgreich geprüft; die Versionen aller 17 direkten Abhängigkeiten bleiben unverändert. Die formale Skill-Validierung wurde bei der Erstabnahme geprüft.

Geprüft sind unter anderem atomarer Rollback einschließlich Run-Fortschritt, Idempotenz vor Revisionkonflikten, unveränderte geschützte Raster, transparente PNGs, Nearest-Neighbor, Projekt- und Historienimporte, Review-Zuordnung, Host/Origin-Prüfungen, große Projektimporte über 16 MB, ungültige JSON-RPC-Envelopes und das Beenden des Services bei offenem Editor.

## Echter Codex-Durchlauf

Codex CLI **0.163.0** war über Streamable HTTP mit dem laufenden Service verbunden. Die Anwendung hat keinen Agenten gestartet; die CLI wurde außerhalb der App zur Abnahme aufgerufen.

- Ein 32×32-Skelett wurde mit getrennten Körper-/Ausrüstungsebenen erstellt, als tatsächliches MCP-PNG inspiziert, korrigiert und exportiert. Der Run dauerte 79 Sekunden.
- Beim anschließenden Präzisionsedit wurde das Schwert exakt drei Rasterpixel länger. Der unabhängige Vergleich fand **11 geänderte Pixel, null außerhalb des erlaubten Bereichs**. Alle übrigen Ebenen waren identisch. Das dekodierte PNG entspricht exakt dem Engine-Raster; der Unity-Pivot ist korrekt normalisiert.
- Neun weitere echte Assets wurden erstellt: Goblin, Ritter, Schleim, Roboter, Boss-Skelett, Schwert, Trank, Schlüssel und Schild. Die Stichprobe umfasst 16–64 Pixel, vier Stilprofile sowie eine Referenzinspektion für Schwert/Schild.
- Alle zehn Assets wurden unabhängig vom zeichnenden Client als Bilder betrachtet. Goblin, Schleim und Trank erhielten danach gezielte Nacharbeiten an Gesicht beziehungsweise Flaschenform. Die Paletten blieben erhalten; die anderen Goblin-Ebenen und der Schleimkörper blieben unverändert.
- Die Ergebnisse sind erkennbare einfache Spielassets. Detailqualität und Stiltreue variieren; professionelle künstlerische Qualität ist damit nicht für beliebige Aufträge bewiesen. Die ursprüngliche vollständige Abnahme durch einen Menschen bleibt eine separate Bewertung.

Die lokalen Testartefakte und genauen IDs liegen im ignorierten Ordner `artifacts/`. Nach einem tatsächlichen Service-Neustart waren alle **8 Projekte, 11 Assets und 46 Revisionen** einschließlich Dokumenten, Historie und Reviews identisch. Eines der Assets gehört zum manuellen Editor-Test.

## Browser

Im echten Browser geprüft: Projekt/Asset anlegen, Stift, Rechteck, Füllen, Auswahl, Verschieben und Kopieren, Hex-Palette, Ebenen anlegen/umbenennen/sperren/entsperren, Undo/Redo, History-Vorschau/Wiederherstellen, Neuladen und Änderungen durch Agenten. Die Browserkonsole war fehlerfrei. Der Direktlink mit `?project=<id>` öffnet das gewünschte Projekt; der schmale Browserbereich bleibt bedienbar.

PNG-/Projektimport und Varianten sind über Backendtests geprüft; die entsprechenden Browser-Dateidialoge wurden nicht zusätzlich manuell geprüft.

Die Navigationserweiterung wurde im Browser mit Handwerkzeug und Ziehen, Zoom am Mauszeiger, Originalgröße (`1`), Einpassen (`F`), Raster (`Umschalt+G`), Hotkey-Übersicht (`?`) und normaler Texteingabe geprüft. Werkzeug-/Zoomkürzel bleiben im Dialog inaktiv. Revision und SHA-256 des vollständigen Dokuments waren danach identisch. Die Konsole meldete keine Warnungen oder Fehler. Touch-Pinch wurde nicht implementiert.

Zusätzlich wurde ein temporärer Service mit In-Memory-Datenbank für einen Browser-Regressionslauf verwendet: Nach einem Strich blieben `Strg+Z` und `Strg+Umschalt+Z` in der historischen Vorschau ohne Änderung am aktuellen Raster oder an den drei Revisionen. Zurück im aktuellen Stand funktionierten Undo und Redo. Der Testservice wurde anschließend beendet. Nach Schließen der Hilfe kehrt der Fokus zum aufrufenden Button zurück.

Der [recherchierte Artist Guide](../skills/pixel-artist/references/artist-guide.md) wird über Workflow-Tool, MCP-Ressource und neue/fortgesetzte Runs konsistent ausgeliefert; das ist per Integrationstest geprüft. Auch der neu gestartete echte Service liefert denselben Guide über Tool und Ressource. Die Bildinspektion enthält nun den gespeicherten Asset-Stil. Ein zusätzlicher vollständiger Codex-/Claude-Artist-Durchlauf mit diesen neuen Regeln wurde nicht durchgeführt.

## Fehlerprüfung nach der Navigationserweiterung

Ein weiterer Browserlauf mit separater In-Memory-Datenbank bestätigt:

- Der zuvor reproduzierte Absturz beim Wechsel von einer historischen großen Palette zur aktuellen kleineren Palette ist behoben. Eine gültige Farbe bleibt gewählt.
- Farbanzahl und Prüfhinweise beziehen sich in der Versionsvorschau auf die angezeigte Revision.
- Eine um 2,5 Sekunden verzögerte Historienantwort überschreibt nach einem Assetwechsel nicht den Verlauf des neuen Assets.
- Während einer um fünf Sekunden verzögerten Speicherantwort eintreffende externe Änderungen werden danach nachgeladen. Die lokale und externe Pixeländerung bleiben erhalten; veraltete Undo-Einträge werden verworfen.
- Nach Trennung der Ereignisverbindung erscheint auch eine während der Trennung gespeicherte Revision nach der Wiederverbindung automatisch.

Neue automatisierte Regressionstests prüfen vollständig transparente PNGs bei gesperrter Projektpalette und wiederholte/ungültige Suchparameter. Der kopierte Agentenauftrag verwendet den gespeicherten Asset-Stil und die tatsächliche Serveradresse (im Vite-Entwicklungsbetrieb den konfigurierten Backend-Port 4317). Datei- und Zwischenablagedialoge wurden in diesem Lauf nicht vollständig geprüft.

## Offene Abnahme

Claude Code **2.1.302** meldete den Pixelator-MCP-Server als verbunden. Der tatsächliche Artist-Durchlauf wurde vor der ersten Generierung durch das Wochenlimit des Claude-Kontos abgewiesen. Claude-Bildverständnis und künstlerische Ergebnisse sind deshalb noch nicht abgenommen. Der zehnteilige Codex-Test ersetzt diesen zweiten Clienttest nicht.

Tilesets und Asset Packs gehören zum nächsten Ausbau; Animationen und Sprite-Sheets sind seit der Ergänzung oben vorhanden. Projektimporte sind in V1 auf 128 MB begrenzt; größere Historien benötigen derzeit ein Datenbank-Backup.
