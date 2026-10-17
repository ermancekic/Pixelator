# Tiles

Ein **Tileset** ist ein Asset mit Kachelraster. Die Leinwand ist ein Vielfaches der Kachelgröße; Kachel-IDs zählen zeilenweise ab 0. Frames animieren alle Kacheln gemeinsam.

## Anlegen und bearbeiten

- **Neues Asset → Tileset:** Kachelgröße (8–32 px) sowie Spalten × Zeilen. 8 × 6 Kacheln reichen für ein Blob-Autotile. Bestehende Assets erhalten im Bereich *Kacheln* ein Raster.
- **Kachel wählen** (`T`): wählt die Kachel unter dem Zeiger und begrenzt das Zeichnen auf sie. Im Bereich *Kacheln* lassen sich Name, Klasse, Häufigkeit, Kollision (keine, voll, Hälften oder eigenes Rechteck) und Terrain festlegen. Die Statusleiste zeigt die Kachel-ID unter dem Zeiger.
- **Terrain-Widget:** Die 3 × 3 Felder sind die acht Nachbarpositionen plus die Mitte. Ein Klick schaltet zum nächsten Terrain, ein Rechtsklick zum vorherigen. Der Modus bestimmt die nutzbaren Felder: *Blob* liest Ecken und Kanten, *Kanten* nur die Seiten, *Ecken* nur die Ecken.
- **Nahtlos zeichnen** (Werkzeugleiste): Stift, Radierer, Schattieren, Linie, Formen und Polygon laufen über den Rand auf der Gegenseite weiter. Die Umgebung zeigt die Wiederholung. **⇲ ½** versetzt die Auswahl, die gewählte Kachel oder die Leinwand um die halbe Größe mit Umlauf, sodass Nähte in die Mitte rücken.
- **Leinwandgröße:** Mit Kachelraster bewegen Größe, Ausrichtung und Zuschnitt ganze Kacheln; die Metadaten wandern mit.

## Autotiles

1. Unter *Autotile-Vorlage* Vorlage und Startkachel wählen. Die Schlüsselkacheln erscheinen markiert auf der Leinwand.
2. Die Schlüsselkacheln zeichnen: **Einzeln** (freistehend), **Waagerecht** (links und rechts verbunden), **Senkrecht** (oben und unten verbunden), **Kreuzung** (alle vier Seiten mit Innenecken) und **Fläche**. Die Kanten-Vorlage braucht nur die ersten vier.
3. **Vorlage vervollständigen:** Jedes Viertel der übrigen Kacheln wird aus dem passenden Viertel einer Schlüsselkachel kopiert, wie bei RPG-Maker-Autotiles. Alle Kacheln erhalten Terrain-Labels. Bei Bedarf wächst die Leinwand.

| Vorlage | Terrain-Modus | Kacheln | Einsatz |
| --- | --- | --- | --- |
| Blob | Ecken und Kanten | 47 | Wände, Inseln, Plattformen mit Innenecken |
| Kanten | Kanten | 16 | Wege, Zäune, Rohre |
| Ecken | Ecken | 5 Schlüssel + 15 | Übergänge Gras/Erde, Wasserufer |

Nach Korrekturen an den Schlüsselkacheln die Vorlage erneut vervollständigen. Eine gerade Kachelgröße ist Voraussetzung.

## Testkarte

Die Testkarte malt eine Beispielform mit den gelabelten Kacheln, wie ein Terrain-Pinsel in Tiled oder Godot. Ein Klick schaltet eine Zelle um (bei Ecken-Sets eine Ecke), `Alt`+Klick wählt die verwendete Kachel. Magenta markiert Kombinationen ohne Kachel; die Kopfzeile zählt alle fehlenden Kombinationen des Modus. Agenten sehen dieselbe Karte über `inspect_asset` mit `preview: "terrain"`.

## Export

| Format | Inhalt |
| --- | --- |
| Tileset-PNG | Alle Kacheln am Rasterplatz. Animierte Kacheln liegen als weitere Zeilenblöcke darunter (ID + Frame × Kacheln pro Frame). |
| Tiled `.tsx` / `.tsj` | Kachelgröße, Rand und Abstand, Klasse, Name als Eigenschaft, Kollision als Objektgruppe, Animationen, Terrain als Wang-Set (`corner`, `edge`, `mixed`). |
| Godot `.tres` | TileSet mit Atlas, Terrain-Set (Modus 0/1/2) und Peering-Bits, Physik-Polygonen, Custom Data (`name`, `type`), Wahrscheinlichkeit und Animationen. |
| Unity | Import-Manifest: ein Sprite pro Kachel bei einer Einheit pro Kachel, animierte Kacheln, Namen und Kollision. |

**Kanten wiederholen** (Extrude) kopiert die Randpixel jeder Kachel nach außen und verhindert Farbsäume beim Filtern in Engines. Bild und Beschreibung gehören in denselben Ordner, weil die Beschreibung das Bild per Dateinamen referenziert; Godot löst den relativen Pfad neben der `.tres` auf. Die Einzelkachel des Blob-Sets hat in Tiled keine Wang-ID, da Tiled kein Zentrum speichert; Godot nutzt sie über das Zentrums-Terrain.

Pixelator erstellt Tilesets, aber keine Level-Karten. Das Leveldesign bleibt in Tiled, LDtk oder der Engine. Hintergrund und Quellen: [Recherchebericht](<../reports/Tiles für Pixelator.md>).
