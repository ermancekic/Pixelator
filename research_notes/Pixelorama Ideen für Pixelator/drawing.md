# Zeichenworkflow: Pixelorama → Pixelator

## 1. Welche Zeichenhilfe lohnt sich zuerst?

### Takeaway
**Priorität 1: horizontale und vertikale Zeichensymmetrie.** Für frontale Figuren, Waffen, Gegenstände und UI-Icons bringt sie unmittelbar etwas und lässt sich auf die bestehenden präzisen Pixeloperationen aufsetzen.

### Cited Findings
- Pixelorama bietet horizontale und vertikale Spiegelung; beide zusammen erzeugen auch das doppelt gespiegelte Gegenstück. Die zentrale Berechnung lautet `symmetry_point - coordinate`; zusätzliche diagonale Achsen existieren ebenfalls. — [Tools.gd, get_mirrored_positions / calculate_mirror_horizontal / calculate_mirror_vertical](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Autoload/Tools.gd#L608-L650)
- Pixelator hat bereits nachträgliches Spiegeln von Ebene/Auswahl, aber der laufende Stiftstrich sammelt ungespiegelte Pixel. — [App.tsx](C:/Repositories/Pixelator/web/App.tsx:263)

### Inferences
- Zwei Werkzeugoptionen „Links/rechts“ und „Oben/unten“, zunächst um die Leinwandmitte, reichen als sinnvolle erste Version. Pro Pixel `(x,y)` werden bei Bedarf `(w-1-x,y)`, `(x,h-1-y)` und `(w-1-x,h-1-y)` erzeugt; Duplikate auf ungeraden Mittelachsen entfallen.
- Die Auswahl muss **nach** der Spiegelung jeden Zielpunkt begrenzen. Sonst würde ein innerhalb der Auswahl begonnener Strich unzulässig außerhalb schreiben. Original und Spiegelpunkte sollten dieselbe Vorschau, Revision und Undo-Aktion bilden.
- Auch Radieren muss gespiegelte Punkte schreiben, deren Ausgangswert bereits der aktiven Farbe entspricht. Ein bloßer Diff der ungespiegelten Zeichenlinie verpasst solche Ziele.
- Linien, Rechtecke und Ellipsen dürfen durch Spiegeln ihrer erzeugten Pixel folgen; Verschieben/Kopieren, Auswahl und Pipette erhalten keine geometrischen Nebeneffekte.

### Gaps
- Einstellbare und diagonale Achsen wären ein weiterer Ausbauschritt; ihr Zusatznutzen rechtfertigt hier zunächst keine zusätzlichen Bedienelemente.

## 2. Was macht Pixelorama bei sauberen Freihandlinien besser?

### Takeaway
**Priorität 2: optionaler Pixel-Perfect-Modus für den 1-Pixel-Stift.** Das ist eine konkrete Qualitätsfunktion: überflüssige rechtwinklige Eckpixel werden während eines Strichs entfernt, während normale Freihandstriche weiter verfügbar bleiben.

### Cited Findings
- Pixelorama aktiviert den Pixel-Perfect-Drawer nur für Pinselgröße 1. — [BaseDraw.gd, _prepare_tool](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/BaseDraw.gd#L388-L405)
- Der Drawer merkt Position und ursprüngliche Farbe der letzten zwei Pixel. Liegen älterer und aktueller Punkt diagonal und der Zwischenpunkt orthogonal daneben, stellt er die **ursprüngliche Farbe** des Zwischenpunkts wieder her. Die Historie wird zu Strichbeginn zurückgesetzt. — [Drawers.gd, PixelPerfectDrawer](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Classes/Drawers.gd#L34-L54)
- Pixelorama überbrückt beim Stift Bewegungszwischenräume und speichert einen gesamten Strich als Undo-Schritt. — [Pencil.gd, draw_start / draw_move / draw_end](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Pencil.gd#L90-L183)
- Pixelator besitzt bereits lückenlose Liniensegmente, Vorschau und einen Speichervorgang pro Strich; bislang fehlt die Eckkorrektur. — [App.tsx](C:/Repositories/Pixelator/web/App.tsx:263)

### Inferences
- Ein eigener kleiner, rein geometrischer Helfer sollte geordnete Bresenham-Punkte sammeln, identische Folgepunkte überspringen und nur lokale L-Knicke korrigieren. Beispiel: `(0,0) → (1,0) → (1,1)` wird zur Diagonale `(0,0) → (1,1)`.
- Vorschau stets vom Originaldokument aufbauen. Entfernen eines Eckpunkts heißt, dort den Ausgangswert wiederherzustellen, keinesfalls transparent zu radieren. Das bewahrt vorhandene Konturen und Farbe unter dem Strich.
- Pixel-Perfect vor Symmetrie berechnen, danach spiegeln und Auswahl begrenzen. Die Optionen zu Strichbeginn festhalten; Abbruch verwirft die ganze Vorschau. Prüfen: L-Ecke, gerade Linie, gleiche Folgepunkte, U-Turn, vorhandene Farbe unter einer Ecke, ungerade Mitte und Auswahl.

### Gaps
- Ein Echtbildvergleich ist zur Qualitätsabnahme nötig; nur geometrische Tests beweisen keine bessere künstlerische Linie.

## 3. Welche kleinen Bedienideen passen außerdem?

### Takeaway
**Priorität 3: Fülleimer zwischen zusammenhängender Fläche und gleicher Farbe umschalten.** Die Engine besitzt den dafür nötigen Farbtausch bereits. Größere Paletten- und Pinselbibliotheken haben gegenüber den beiden Zeichenhilfen weniger unmittelbaren Nutzen.

### Cited Findings
- Pixeloramas Bucket unterscheidet Fläche, Farben und Auswahl sowie Farbe/Pattern; ein temporärer Moduswechsel stellt nach Loslassen die vorige Füllart wieder her. — [Bucket.gd, FillArea / _input](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Bucket.gd#L1-L44)
- Pixeloramas Werkzeuge lassen sich unabhängig auf linke und rechte Maustaste legen; Farben und Werkzeuge können getauscht werden. — [Tools.gd, Slot / swap_color / swap_tools](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Autoload/Tools.gd#L366-L375)
- Pixelator bietet bereits indexbasierte Paletten, Pipette, globale Palettenfarbänderung und Engine-Operation `replace`; der Browser-Fülleimer ruft derzeit nur zusammenhängendes `fill` auf. — [Engine](C:/Repositories/Pixelator/src/engine.ts:267), [Editor](C:/Repositories/Pixelator/web/App.tsx:292)

### Inferences
- Ein sichtbarer „Zusammenhängend / Gleiche Farbe“-Schalter kann vorhandenes `fill` oder `replace` im aktiven Layer verwenden, bei Auswahl nur in deren Rechteck. Keine Farbtoleranz nötig, solange nur exakte Palettenindices existieren.
- Dynamisch frei belegbare Maustasten wären nützlich, verlangen aber mehr UI, Fokus- und Kontextmenüverhalten. Erst nach den Zeichenhilfen angehen.
- Toleranzregler, RGBA-Mischen, Pattern-Bibliothek und große Shader-Effekte zunächst zurückstellen: Pixelators Indexraster und fokussierter MCP-Workflow brauchen sie aktuell weniger.

### Gaps
- Pixeloramas Dokumentationslinks führten beim Abruf am 17.10.2026 auf die neue Website; der dortige Introduction-Link lieferte 404. Die Empfehlungen beruhen deshalb auf dem offiziellen Repository und tatsächlich gelesenem Quellcode, nicht auf behauptetem Testen der App.
