# Pixelorama: Vorschau und zugängliche Editor-Arbeitsschritte

## Was macht Pixelorama bei der Bildbeurteilung gut?

### Takeaway
Pixelorama erlaubt, die Vorschau unabhängig von der Zeichenansicht zu vergrößern. Der größte unmittelbare Gewinn für Pixelator ist eine verlässliche Vorschau in ganzen Maßstäben; die bestehende Miniatur ist bereits nützlich, aber nicht durchgehend wirklich 1:1.

### Cited Findings
- Die Vorschau besitzt eine eigene Kamera und einen Zoom-Schieberegler; `_on_PreviewZoomSlider_value_changed` setzt nur die Vorschaukamera. Ein Doppelklick kann die Hauptkamera auf die in der Vorschau gewählte Stelle ausrichten. — [Pixelorama: CanvasPreviewContainer.gd](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/UI/CanvasPreviewContainer/CanvasPreviewContainer.gd)
- Pixelorama zeichnet die aktuelle Komposition im Vorschau-Canvas, unabhängig von der später möglichen Animationswiedergabe. — [Pixelorama: CanvasPreview.gd](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/UI/Canvas/CanvasPreview.gd)
- Pixelator zeigt bereits eine mit „1:1“ beschriftete Vorschau. Deren CSS begrenzt das Canvas aber durch `max-width:100%` und `max-height:100%`; ein Bild über ungefähr 99 px Höhe kann damit heruntergerechnet erscheinen. Die Vorschau folgt dank `document = preview ?? viewRevision?.document ?? detail?.revision.document` bereits einem laufenden Strich und historischen Revisionen. — [Pixelator: App.tsx](/C:/Repositories/Pixelator/web/App.tsx:364), [Pixelator: styles.css](/C:/Repositories/Pixelator/web/styles.css:2)

### Inferences
- Priorität 1: Auswahl 1× / 2× / 4× mit wirklich festen Canvas-Abmessungen und scrollbar statt automatisch geschrumpft. Pixelator-Ansichtsänderungen benötigen keine Revision und lassen sich damit sehr klein umsetzen.
- Heller, dunkler und karierter Vorschauhintergrund sind eine sinnvolle eigene Ergänzung: kontrastarme Kanten und versehentlich transparente Innenflächen werden sichtbar. Das ist eine abgeleitete Empfehlung, keine Behauptung über ein bestimmtes aktuelles Pixelorama-Menü.

### Gaps
- Die verlinkte offizielle Dokumentation leitet derzeit auf die neue Website; der dortige Dokumentationslink `/Introduction` antwortet mit 404. Daher wurden aktuelle Quelltexte als Beleg verwendet. — [Pixelorama-Website](https://pixelorama.org/)

## Welche Muster helfen bei wiederkehrenden Sprites und Tiles?

### Takeaway
Pixelorama bietet Hilfen direkt am Arbeitsbild. Für Pixelator sind eine 3×3-Kachelvorschau und einfache Zeichensymmetrie besonders passend, ohne schon einen vollständigen Tilemap-Editor einzuführen.

### Cited Findings
- Das offizielle README nennt Tile Mode, Hilfslinien und Raster als Werkzeuge für nahtlose, präzise Muster. — [Pixelorama README, Advanced Canvas Options](https://github.com/Orama-Interactive/Pixelorama#features)
- `Tools.get_mirrored_positions` erzeugt horizontale, vertikale und kombinierte Gegenpunkte; `calculate_mirror_horizontal` und `calculate_mirror_vertical` spiegeln um projektbezogene Symmetriepunkte. — [Pixelorama: Tools.gd](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Autoload/Tools.gd#L607-L650)
- Pixelator bietet bereits nachträgliches Spiegeln einer Ebene oder Auswahl, aber weder Zeichensymmetrie noch eine wiederholte Vorschau. Seine Zeichenwerkzeuge erzeugen Operationen aus dem ursprünglichen Strich. — [Pixelator: App.tsx](/C:/Repositories/Pixelator/web/App.tsx:262), [Pixelator: App.tsx](/C:/Repositories/Pixelator/web/App.tsx:368)

### Inferences
- Priorität 2: 3×3-Wiederholung der aktuellen Komposition im vorhandenen Vorschauabschnitt. Sie macht Nähte an allen Kanten sichtbar und benötigt keinerlei Änderung des Datenformats. Sie ist nur eine Vorschau; ein vollständiger Tileset-Workflow bleibt ein eigener späterer Ausbau.
- Priorität 3: Schalter „Symmetrie X/Y“ für Stift/Radierer, Linien und Formen. Mittelachse aus `(width - 1)` bzw. `(height - 1)` ableiten; Duplikate auf ungeraden Mittelachsen entfernen; Auswahlgrenzen weiterhin respektieren. Mit einer Revision pro Strich bleiben Rückgängig und Agent-/Browser-Konsistenz verständlich.

### Gaps
- Diese Vorschläge übernehmen das Arbeitsprinzip. Sie erheben keinen Anspruch, Pixeloramas beliebig verschiebbare oder diagonale Symmetrieachsen vollständig abzubilden. — [Pixelorama: Tools.gd](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Autoload/Tools.gd#L607-L650)

## Welche kleinen Arbeitsschritte fehlen, welche sind schon vorhanden?

### Takeaway
Ebenenduplikation schließt eine echte Lücke für sichere Varianten. Native Miniatur, Ebenenreihenfolge, Palette, Ebenensperren und grundlegende Hotkeys existieren hingegen bereits und sollten als Ausgangspunkt genutzt werden.

### Cited Findings
- Pixelorama klont über `_on_CloneLayer_pressed` die Ebene samt Inhalt, fügt „copy“ zum Namen hinzu, setzt sie direkt über die Quelle, wählt sie an und registriert die Änderung in Undo/Redo. — [Pixelorama: AnimationTimeline.gd](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/UI/Timeline/AnimationTimeline.gd)
- Pixelator enthält bereits Buttons für Reihenfolge, Sichtbarkeit, Sperre, Umbenennen, Löschen sowie Spiegeln und Rotation. Die Operationstypen haben `add_layer`, `remove_layer`, `update_layer` und `reorder_layers`, aber kein Ebenenduplikat. — [Pixelator: App.tsx](/C:/Repositories/Pixelator/web/App.tsx:368), [Pixelator: types.ts](/C:/Repositories/Pixelator/src/types.ts:82)
- Pixelator besitzt Zoom zum Mauszeiger, Panning, Originalgröße, Raster und eine Hotkey-Übersicht. — [Pixelator: README](/C:/Repositories/Pixelator/README.md:89), [Pixelator: view-helpers.ts](/C:/Repositories/Pixelator/web/view-helpers.ts:1)

### Inferences
- Ebenenduplikation ist ein zusätzlicher guter kleiner Kandidat: neue ID, kopiertes Pixelarray, gleicher Name mit „Kopie“, unmittelbar oberhalb der Quelle, neue Ebene wählen, ein Undo-Schritt. Für Browser und MCP sollte sie als deterministische Engine-Operation verfügbar sein.
- Eine native Vorschau und Ebenenreihenfolge erneut als komplett neue Features zu verkaufen wäre sachlich falsch. Sinnvoll sind die präzisen Verbesserungen an diesen existierenden Funktionen.

### Gaps
- Keine Benchmark- oder Nutzerstudie belegt eine gemessene Zeitersparnis für genau Pixelators Anwender. Die Rangfolge ist Produkturteil aus aktuellem Umfang, Implementierungsaufwand und direkter Bildbeurteilung.
