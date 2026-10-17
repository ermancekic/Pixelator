# Prüfung und Abnahme

Die automatisierten Prüfungen sind mit `npm run typecheck`, `npm test` und `npm run build` ausführbar. Ihr Erfolg belegt keine künstlerische Qualität und keine Bildübertragung an einen Agenten-Client. Die folgenden realen Durchläufe sind eine gesonderte Abnahme; dieses Dokument behauptet nicht, dass sie bereits erfolgt ist.

## Technische Integrität

| Bereich | Erwartung |
| --- | --- |
| Raster und Palette | Nur erlaubte Größen und Indizes; Index `0` transparent; sichtbare Farben innerhalb der Grenze. |
| Atomare Bearbeitung | Ein ungültiger Befehl verwirft den gesamten Batch; keine teilweise gespeicherte Änderung. |
| Lokaler Edit | Rasterwerte außerhalb der erlaubten Ebene und des Rechtecks bleiben exakt gleich. Verschieben berücksichtigt Ausgangs- und Zielbereich. |
| Gesperrte Ebene | Zeichen- und Strukturänderungen umgehen die Sperre nicht. |
| Revisionen | Alte Revisionen bleiben lesbar; Wiederherstellen erzeugt eine neue aktuelle Revision. |
| Löschen | Bestätigung nennt Asset bzw. Projekt und endgültigen Umfang. Revisionen, Replay-Anfragen und Aufträge werden atomar entfernt. Varianten bleiben eigenständig; andere Projekte unverändert. Externe Löschungen leeren die betroffene Ansicht und schließen veraltete Löschdialoge. |
| Große Raster | Füllen und Vorschau bleiben rastergenau; schnelle Striche verlieren keine Zwischenpunkte. Kleine Thumbnails verwenden begrenzte Pixelpuffer. Der Verlauf liefert Metadaten und lädt historische Raster einzeln. |
| Konkurrenz | Veraltete `expectedRevision` wird abgelehnt; derselbe `requestId` mit demselben Payload erzeugt keine doppelte Änderung. |
| Render und Export | Nearest-Neighbor-Vorschau; PNG mit korrekten Abmessungen und echtem Alpha; JSON und Unity-Metadaten passen zur Revision. |
| Persistenz | Nach Service-Neustart sind Projekte, Assets und Revisionen wieder vorhanden. |
| Artist-Run | Abbruch und Limits erhalten den letzten gültigen Stand; Fertigstellen prüft den aktuellen statt eines alten Review-Stands. |
| Artist Guide | Aktuelle Regeln über `get_workflow`, Ressource und Start/Fortsetzen konsistent verfügbar; Stilkontext beim PNG. |
| Navigation/Hotkeys | Zoom hält den Punkt am Mauszeiger, bleibt ganzzahlig und begrenzt; Pan verändert keine Rasterdaten; Eingaben und Dialoge blockieren Editor-Kürzel. |
| Fensteraufteilung | Bibliothek/Eigenschaften in der Breite und Timeline/Vorschau/Palette/Ebenen in der Höhe ziehen; Mindestgrößen schützen die Zeichenfläche. Größen bleiben nach Neuladen erhalten. Doppelklick oder Enter setzt den Bereich zurück; Pfeiltasten sowie Home/End ändern die Größe ohne Editor-Kürzel auszulösen. Beim Verkleinern des Fensters bleiben Bereiche erreichbar; mobil werden Desktopgrößen ignoriert. |
| Zeichensymmetrie | Stift, Radierer, Linie und Formen spiegeln um die Leinwandmitte; gerade/ungerade Maße und kombinierte Achsen erzeugen korrekte, eindeutige Punkte. Auswahlgrenzen gelten für jedes Ziel; ein Strich bleibt eine Revision. |
| Pixel-Perfect-Stift | L-Knicke werden optional korrigiert; Geraden, Richtungswechsel und wiederholte Punkte bleiben korrekt. Unter entfernten Eckpunkten erscheint die ursprüngliche Farbe. Vorschau und gespeicherter Strich stimmen überein; Abbruch verwirft die Vorschau. |
| Füllreferenz und Reichweite | Defaults bewahren bisheriges Fill. Zusammenhängend/global und Ebene/Gesamtbild funktionieren einschließlich Transparenz, verborgener Ebenen, Auswahl und Sperre. Nur die Zielebene wird geschrieben; gleiche Referenz- und Zielfarbe verhindert nötige Zieländerungen nicht. |
| Ebenenduplikat | Eigener Pixelpuffer, neue eindeutige ID, Kopie unmittelbar oberhalb der Quelle; Quelle unverändert, Sichtbarkeit/Sperre erhalten. Scope, Ebenenlimit und atomare Fehlerbehandlung gelten; Browser und MCP erreichen dieselbe Operation. |
| Kompakte Raster (`rows`, `read_pixels`) | `rows` erzeugt dasselbe Dokument wie `patch`; `over` erhält Pixel unter `.`; `read_pixels` → `rows` ist verlustfrei; Bereiche über 16 384 Zellen werden abgelehnt. |
| Frames und Scope | Zeichenoperationen treffen genau einen Frame; ohne eindeutigen Frame `FRAME_REQUIRED`. Frames außerhalb von `editScope.frameIds` bleiben nachweislich gleich. Frame-Struktur verlangt alle Ebenen, kein Rechteck und `allowFrameChanges`. |
| Tags | Einfügen in/hinter einem Tag verlängert ihn, davor verschiebt ihn; Löschen des einzigen Frames entfernt ihn (Pixelorama-Regeln). Doppelte Namen und ungültige Bereiche werden abgelehnt. |
| Alte Daten | Gespeicherte Dokumente ohne Frames, alte Replay-Antworten und Projektbundles Version 1 werden als ein Frame gelesen, ohne Pixel zu ändern. |
| Animationsprüfung | `inspect_asset` zeigt alle Frames als ein Sheet mit Trennfarbe außerhalb der Palette; Onion färbt nur Nachbarframes und nur transparente Stellen. `completed` verlangt eine Inspektion aller Frames. |
| Animationsexport | Sheet-PNG pixelgleich zu den Einzelframes; Aseprite-JSON mit Rechtecken, Dauern, Tags und Pivot; Unity mit Sprite je Frame (Ursprung unten links) und Clip je Tag; GIF mit Dauern, Transparenz, Tag-Richtung und Loop. Ein exportiertes Sheet lässt sich verlustfrei als Frames re-importieren. |
| Timeline im Editor | Frames anlegen/duplizieren/verschieben/löschen und Dauer/Tags ändern erzeugen je eine Revision mit Undo/Redo. Zeichnen trifft nur den gewählten Frame. Wiedergabe nutzt die echten Dauern; Onion Skin verändert keine Daten. |
| Auswahlmasken | `editScope.mask` lässt nur `#`-Pixel im Rechteck schreiben; Füllen, Ersetzen und Kontur bleiben darin, andere Operationen werden abgelehnt. Lasso, Zauberstab, Hinzufügen/Abziehen und das Verschieben/Spiegeln/Drehen von Freiformen ändern nur ausgewählte Pixel. |
| Leinwandgröße | `resize_canvas` vergrößert, verkleinert und verschiebt alle Ebenen und Frames, setzt den Pivot mit, aktualisiert die Assetgröße und lehnt das Abschneiden gesperrter Pixel ab. Zuschneiden auf Auswahl/Inhalt und Wiederherstellen älterer Größen funktionieren. |
| Ebenen zusammenführen | Ergebnis liegt in der untersten Ebene, das Gesamtbild bleibt pixelgleich; sichtbare Zwischenebenen, gesperrte oder verborgene Quellen werden abgelehnt. Alle Frames werden zusammengeführt. |
| Zwischenablage | Kopieren/Einfügen innerhalb eines Assets ist pixelgleich; zwischen Paletten werden Farben exakt zugeordnet, angehängt oder angenähert. Einfügen als Ebene ist eine Revision; fremde PNGs aus der System-Zwischenablage werden gelesen. |
| Pinsel, Muster, Schattieren | Pinselgrößen und -formen, an der Leinwand ausgerichtete Muster mit optionaler Zweitfarbe sowie Schattieren entlang Palette/Helligkeit; Transparenz bleibt beim Schattieren unverändert. |
| Palettendateien und Export | GPL/PAL/HEX/TXT werden gelesen und GPL/PAL/HEX geschrieben; „Pixel zuordnen“ ersetzt jedes Pixel durch die ähnlichste Farbe. PNG, Sheet und GIF lassen sich 1–16× exportieren; Sheet-JSON adressiert das vergrößerte Bild. |
| Exportfenster | Jedes Format nennt seine Dateien mit den Server-URLs; die Vorschau von Sheet und Tileset ist pixelgleich zur heruntergeladenen Datei, Textformate zeigen den Dateiinhalt. Mehrere Dateien werden alle geladen; nicht passende Formate (Sheet/GIF ohne Animation, Tileset ohne Raster) sind gesperrt. Einstellungen bleiben erhalten. |
| Menüleiste und Einstellungen | Menüs per Maus und Tastatur; Einträge lösen dieselben Befehle wie Werkzeugleisten und Kürzel aus. Bibliothek, Eigenschaften, Animationsleiste und Raster lassen sich ausblenden; Sprache und Ansicht überstehen ein Neuladen. |
| Sprache | Englisch ist Standard. Jeder Oberflächentext hat eine englische Übersetzung mit denselben Platzhaltern; in der englischen Oberfläche erscheint kein deutscher Text. Servermeldungen sind englisch und in der deutschen Oberfläche übersetzt. |
| Referenzbild | Hinter/über der Zeichnung, Deckkraft und Einpassung einstellbar; keine Änderung an Dokument, Revisionen oder Exporten. |
| Tileset-Raster | Raster nur bei teilbarer Leinwand; Kachel-IDs zeilenweise; Metadaten (Name, Klasse, Häufigkeit, Kollision im Kachelbereich, Terrain nur auf vom Modus gelesenen Positionen) werden validiert. Neue Kachelgröße setzt Metadaten zurück; Leinwandänderungen um ganze Kacheln nehmen sie mit, andere werden abgelehnt. |
| Autotiles | Blob 47, Kanten 16 und Ecken 15 entstehen aus den Schlüsselkacheln, sind gelabelt und vollständig; ungerade Kachelgrößen und zu kleine Raster werden mit Größenangabe abgelehnt. Fehlende Kombinationen erzeugen `TERRAIN_INCOMPLETE` und Magenta-Zellen in der Testkarte. |
| Nahtlos und Versatz | Striche und Formen laufen auf wrappenden Achsen über den Rand; `shift` versetzt mit Umlauf, nur im Rechteck. Geisterkacheln verändern keine Daten. |
| Tileset-Export | PNG mit Extrude/Abstand; animierte Kacheln als Zeilenblöcke; Tiled TSX/TSJ mit Klasse, Name, Kollision, Animation und Wang-Set; Godot `.tres` mit Terrain-Modus, Peering-Bits, Physik, Custom Data und Animation; Unity-Manifest. Godot lädt das TileSet, und sein Terrain-Pinsel wählt dieselben Kacheln wie die Testkarte; ein Tiled-Parser liest TSX und TSJ gleich. |
| Projektübersicht | `GET /api/projects/overview` liefert pro Projekt Assetzahl, letzte Änderung und bis zu vier zuletzt geänderte Assets. Das Fenster sortiert nach Aktivität, markiert das geöffnete Projekt, sucht, wechselt per Klick, Pfeiltasten und `Enter`, schließt mit `Esc` und bleibt mobil ohne horizontales Scrollen. |
| Vorschau und Kacheln | „Einpassen“ zeigt das ganze Bild, große Bilder verkleinert; 1×/2×/4×/8× zeigen feste Pixelmaße, große Bilder scrollen. Hintergrundwechsel und 3×3-Wiederholung verändern keine Dokumentdaten. Laufender Strich und historische Revision werden korrekt dargestellt. |

## Echter MCP-Durchlauf

Mit den tatsächlich verwendeten Codex-/Claude-/Antigravity-Clients separat prüfen. Die App darf dabei weder ein Modell laden noch einen Agenten starten.

1. Service starten, Client per MCP verbinden und Pixel-Artist-Skill laden. Client-Version, Modell und Transport notieren.
2. Ein 32×32-Skelett mit separater Schwertebene erstellen. `inspect_asset` muss ein echtes PNG als MCP-Bildinhalt liefern. Prüfen, dass der Agent dieses Bild tatsächlich visuell auswerten kann; ein Link oder JSON mit Bildmaßen reicht nicht.
3. Eine konkrete visuelle Beobachtung mit zugehöriger Revisions-ID aufzeichnen. Eine sichtbare Verbesserung vornehmen, erneut inspizieren und bewerten.
4. Das Schwert um exakt drei Pixel verlängern. Vorher-/Nachher-Raster vergleichen: alle Pixel außerhalb des erlaubten Bereichs müssen unverändert bleiben.
5. Endrevision prüfen, PNG und Unity-Export erzeugen und denselben Stand im Browser öffnen. Transparenz und Pivot kontrollieren.
6. Einen Run abbrechen und ein Limit erreichen. Der letzte gültige Stand bleibt erhalten. Gleichzeitige manuelle Bearbeitung muss einen Konflikt statt stillen Überschreibens auslösen.

Kann ein Client Bildantworten nicht weiterreichen, ist dieser Artist-Workflow dort noch nicht abgenommen. `record_review` beweist eine protokollierte Beobachtung, kein visuelles Verständnis des Modells.

## Visuelle Stichprobe: 20 reale Aufgaben

Jede Aufgabe mit dem realen externen Agenten ausführen. Die erste vollständige Zeichnung und die Endrevision nach höchstens drei Korrekturrunden aufbewahren. Motiv und Stil bei nativer Größe sowie vergrößert beurteilen: erkennbar, im Spiel lesbar, Vorgaben eingehalten, nach Korrektur besser/gleich/schlechter. Dauer, Client/Modell, Asset-/Revisions-IDs und offene Probleme festhalten. Keine Bewertung allein aus der Selbsteinschätzung des zeichnenden Agenten ableiten.

| Nr. | Aufgabe | Schwerpunkt |
| --- | --- | --- |
| 01 | 32×32 Skeleton Warrior, 16-Bit, Seite | Silhouette und getrenntes Schwert |
| 02 | 32×32 Goblin mit Dolch, 16-Bit, Seite | Gesicht und Gameplay-Merkmale |
| 03 | 32×32 Ritter mit Schild, 16-Bit, Front | Lesbare Ausrüstung |
| 04 | 16×16 Schleimgegner, Game Boy, Front | Kleine Auflösung und Palette |
| 05 | 48×48 Roboter, 8-Bit, Front | Proportionen und Material |
| 06 | 64×64 Boss-Skelett, 16-Bit, Seite | Detaildisziplin bei größerem Raster |
| 07 | 16×16 Eisenschwert, 8-Bit | Diagonalen und Metallfarben |
| 08 | 16×16 Gesundheitstrank, Game Boy | Glas und Erkennbarkeit |
| 09 | 16×16 Schlüssel, 1-Bit | Form mit kleiner Palette |
| 10 | 24×24 Eisenschild passend zu Nr. 07 | Asset-Familie und Referenzinspektion |
| 11 | 32×32 Holzkiste, 8-Bit, Front | Outline und Licht |
| 12 | 32×32 Eiche, Game Boy, Front | Organische Silhouette |
| 13 | 24×24 Felsen, 16-Bit, Front | Flächen und Shading |
| 14 | 48×48 Dungeon-Tür, 16-Bit, Front | Symmetrie und Kontrast |
| 15 | 8×8 Herzsymbol, 1-Bit | Minimale Auflösung |
| 16 | 16×16 Inventartasche, 8-Bit, Front | UI-Lesbarkeit |
| 17 | Schwert aus Nr. 01 um 3 Pixel verlängern | Messbare lokale Änderung |
| 18 | Nur Rüstungsfarben aus Nr. 03 ändern | Identität und unveränderte Umgebung |
| 19 | Elite-Variante aus Nr. 02 erstellen | Eigenständige Variante und Herkunft |
| 20 | Beschädigte Version der Kiste aus Nr. 11 | Wiedererkennbare Grundform |
| 21 | 32×32 Skelett aus Nr. 01: 4-Frame-Idle und 6-Frame-Walk, Tags `idle`/`walk` | Ankerstabilität am Pivot, Loop-Übergang |
| 22 | 16×16 Schleim: 2-Frame-Hüpfen mit Squash | Volumen und Timing |
| 23 | 16×16 Münze: 6-Frame-Drehung, GIF und Sheet exportieren | Gleichmäßige Rotation, Export in einer Engine importieren |

Die technische Abnahme verlangt fehlerfreie Integritätsprüfungen. Die visuelle Stichprobe dokumentiert die erreichte Qualität samt Ausfällen; sie ist keine allgemeine Garantie für alle Motive, Stile oder Agentenmodelle.
