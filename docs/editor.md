# Editor

Kurzreferenz der Bearbeitungsfunktionen. Alle Kürzel zeigt der Editor unter `?`.

## Zeichnen

- **Pinsel:** Stift, Radierer und Schattieren nutzen 1–16 px, quadratisch oder rund (`<`/`>` oder `[`/`]`). Pixel-Perfect gilt nur bei 1 px.
- **Zweitfarbe:** Rechtsklick auf eine Palettenfarbe oder `Alt` + Pipette; `X` tauscht beide Farben.
- **Dithering:** Stift, Linie, Rechteck, Ellipse, Polygon und Füllen kennen Muster (Schachbrett, 12,5/25/75 %, Linien, Diagonal). Die Muster sind an der Leinwand ausgerichtet, sodass Striche nahtlos anschließen. Mit „Zweitfarbe“ werden die Lücken gefüllt, sonst bleiben sie unverändert.
- **Schattieren** (`S`): verschiebt deckende Pixel einen Schritt heller oder dunkler, entlang der Palettenreihenfolge oder sortiert nach Helligkeit. Transparenz bleibt unberührt; jedes Pixel ändert sich höchstens einmal pro Strich.
- **Polygon** (`U`): Klicks setzen Ecken (höchstens 128); `Enter`, Doppelklick oder ein Klick auf den Startpunkt schließen es, `Esc` bricht ab.
- **Kontur und Farbe ersetzen** (Ebenen-Tab): Kontur mit oder ohne Ecken um die aktive Ebene oder alle sichtbaren Ebenen. Ersetzen tauscht die aktive Farbe in der Ebene oder in allen entsperrten Ebenen, optional in allen Frames.

## Auswahl

- Rechteck (`V`), Lasso (`Q`) und Zauberstab (`W`, mit Zusammenhängend/Referenz wie beim Füllen). `Umschalt` erweitert, `Alt` zieht ab; `Strg+A` wählt alles, `Strg+D` hebt die Auswahl auf.
- Zeichnen, Füllen, Kontur, Ersetzen und Löschen wirken nur innerhalb der Auswahl; Verschieben, Spiegeln und Drehen bewegen nur die ausgewählten Pixel. Freiformen gehen als Maske an die Engine.

## Zwischenablage

- `Strg+C` kopiert die aktive Ebene, `Strg+Umschalt+C` alle sichtbaren Ebenen, `Strg+X` schneidet aus. Ohne Auswahl gilt die ganze Leinwand. Die Kopie liegt zusätzlich als PNG in der System-Zwischenablage.
- `Strg+V` fügt in die aktive Ebene ein, `Strg+Umschalt+V` als neue Ebene. Ziel ist die Auswahl, sonst die Ursprungsposition oder die Mitte. Transparente Pixel überschreiben nichts; das Eingefügte wird ausgewählt und das Verschieben-Werkzeug aktiv.
- Farben werden exakt zugeordnet. Fehlende Farben werden an eine entsperrte Palette angehängt, solange Platz ist, sonst durch die ähnlichste Farbe ersetzt. Pixel mit Alpha unter 50 % gelten beim Einfügen fremder Bilder als transparent.

## Leinwand, Ebenen und Palette

- **Leinwandgröße** (Zuschneiden-Symbol oder Klick auf die Auflösung): neue Größe mit Ausrichtung, „Auf Auswahl zuschneiden“ oder „Auf Inhalt zuschneiden“. Gilt für alle Ebenen und Frames; der Pivot wandert mit. Gesperrte Ebenen verhindern das Abschneiden ihrer Pixel.
- **Zusammenführen:** mit der Ebene darunter oder alle sichtbaren Ebenen. Verborgene Ebenen bleiben erhalten; das Bild ändert sich nicht.
- **Paletten:** „Datei laden“ liest GIMP (`.gpl`), JASC (`.pal`), Lospec/Hex (`.hex`) und Paint.NET (`.txt`). „Palette übernehmen“ färbt jeden Index um, „Pixel zuordnen“ setzt jedes Pixel auf die ähnlichste neue Farbe. Export als `.gpl`, `.hex` oder `.pal`.

## Export und Referenzbild

- Die Exportgröße neben „PNG exportieren“ (1–16×) gilt für PNG, Sprite-Sheet, Sheet-JSON und GIF; Unity-Metadaten bleiben bei 1×.
- Das Referenzbild liegt wahlweise hinter oder über der Zeichnung, mit Deckkraft und Einpassung. Es gehört nicht zum Asset, erscheint in keinem Export und wird nur in diesem Browser gespeichert (größere Bilder nur für die laufende Sitzung).
