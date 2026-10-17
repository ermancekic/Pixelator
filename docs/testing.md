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
| Konkurrenz | Veraltete `expectedRevision` wird abgelehnt; derselbe `requestId` mit demselben Payload erzeugt keine doppelte Änderung. |
| Render und Export | Nearest-Neighbor-Vorschau; PNG mit korrekten Abmessungen und echtem Alpha; JSON und Unity-Metadaten passen zur Revision. |
| Persistenz | Nach Service-Neustart sind Projekte, Assets und Revisionen wieder vorhanden. |
| Artist-Run | Abbruch und Limits erhalten den letzten gültigen Stand; Fertigstellen prüft den aktuellen statt eines alten Review-Stands. |
| Artist Guide | Aktuelle Regeln über `get_workflow`, Ressource und Start/Fortsetzen konsistent verfügbar; Stilkontext beim PNG. |
| Navigation/Hotkeys | Zoom hält den Punkt am Mauszeiger, bleibt ganzzahlig und begrenzt; Pan verändert keine Rasterdaten; Eingaben und Dialoge blockieren Editor-Kürzel. |
| Zeichensymmetrie | Stift, Radierer, Linie und Formen spiegeln um die Leinwandmitte; gerade/ungerade Maße und kombinierte Achsen erzeugen korrekte, eindeutige Punkte. Auswahlgrenzen gelten für jedes Ziel; ein Strich bleibt eine Revision. |
| Pixel-Perfect-Stift | L-Knicke werden optional korrigiert; Geraden, Richtungswechsel und wiederholte Punkte bleiben korrekt. Unter entfernten Eckpunkten erscheint die ursprüngliche Farbe. Vorschau und gespeicherter Strich stimmen überein; Abbruch verwirft die Vorschau. |
| Füllreferenz und Reichweite | Defaults bewahren bisheriges Fill. Zusammenhängend/global und Ebene/Gesamtbild funktionieren einschließlich Transparenz, verborgener Ebenen, Auswahl und Sperre. Nur die Zielebene wird geschrieben; gleiche Referenz- und Zielfarbe verhindert nötige Zieländerungen nicht. |
| Ebenenduplikat | Eigener Pixelpuffer, neue eindeutige ID, Kopie unmittelbar oberhalb der Quelle; Quelle unverändert, Sichtbarkeit/Sperre erhalten. Scope, Ebenenlimit und atomare Fehlerbehandlung gelten; Browser und MCP erreichen dieselbe Operation. |
| Vorschau und Kacheln | 1×/2×/4×/8× zeigen feste Pixelmaße ohne automatisches Schrumpfen; große Bilder scrollen. Hintergrundwechsel und 3×3-Wiederholung verändern keine Dokumentdaten. Laufender Strich und historische Revision werden korrekt dargestellt. |

## Echter MCP-Durchlauf

Mit den tatsächlich verwendeten Codex-/Claude-Clients separat prüfen. Die App darf dabei weder ein Modell laden noch einen Agenten starten.

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

Die technische Abnahme verlangt fehlerfreie Integritätsprüfungen. Die visuelle Stichprobe dokumentiert die erreichte Qualität samt Ausfällen; sie ist keine allgemeine Garantie für alle Motive, Stile oder Agentenmodelle.
