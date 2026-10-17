# Tiles: Was Spiele brauchen und was Pixelator dafür ergänzt

Spiele bauen Level aus wiederverwendbaren Kacheln. Ein Pixel-Editor muss dafür drei Dinge leisten: **Tilesets mit festem Raster erstellen, Übergänge zwischen Flächen (Autotiles) ohne Handarbeit vollständig machen und das Ergebnis samt Metadaten so exportieren, dass Tiled und Engines es direkt verstehen.** Pixelator konnte vor dieser Ergänzung nur ein Einzelbild in einer 3×3-Vorschau wiederholen. Es fehlten Kachelraster, Kachel-Metadaten, Autotiling, nahtloses Zeichnen und jeder Tileset-Export. Recherchiert am 17. Oktober 2026; Quellen siehe unten.

## Was die etablierten Werkzeuge erwarten

**Tiled** ist das verbreitete Austauschformat zwischen Pixel-Editor und Engine. Ein Tileset beschreibt Bild, Kachelgröße, `margin`, `spacing`, Kachelzahl und Spalten. Pro Kachel kommen Klasse (`type`), Eigenschaften, Wahrscheinlichkeit, Kollisionsformen als Objektgruppe und Animationen als Folge aus `tileid` und `duration` in Millisekunden hinzu ([JSON-Format][tiled-json], [TMX-Format][tiled-tmx]).

Übergänge beschreibt Tiled seit Version 1.5 als **Wang-Sets** vom Typ `corner`, `edge` oder `mixed`. Jede Kachel erhält eine Wang-ID aus acht Werten in der Reihenfolge oben, oben rechts, rechts, unten rechts, unten, unten links, links, oben links; 0 heißt „nicht gesetzt“ ([TMX-Format][tiled-tmx]). Laut Handbuch hat ein vollständiges Ecken- oder Kanten-Set mit zwei Terrains 16 Kacheln. Ein Misch-Set hätte 256, lässt sich aber auf das 47-teilige Blob-Tileset reduzieren ([Terrain-Handbuch][tiled-terrain]). In Karten kodieren die obersten Bits der Kachel-ID Spiegelungen und Drehung ([Global Tile IDs][tiled-gids]).

**Godot 4** speichert ein TileSet mit Atlas, Rand (`margins`), Abstand (`separation`) und Kachelgröße. Terrain-Sets haben die Modi „Ecken und Kanten“, „Ecken“ und „Kanten“ (0/1/2) ([TileSet][godot-tileset], [TileSetAtlasSource][godot-atlas]). Jede Kachel trägt ein Zentrums-Terrain und Peering-Bits zu ihren Nachbarn, dazu Physik-Polygone, Custom Data und Wahrscheinlichkeit ([TileData][godot-tiledata]).

Die Schlüssel im Textformat haben wir im Quelltext von Godot 4.3 nachgelesen ([tile_set.cpp][godot-source]):
- Peering-Bits heißen `terrains_peering_bit/right_side` usw.
- Kollision steht unter `physics_layer_0/polygon_0/points`.
- Frame *k* einer Animation liegt bei `Koordinate + (Größe + animation_separation) × (k mod Spalten, k div Spalten)`.

Relative Texturpfade löst Godot neben der `.tres`-Datei auf ([resource_format_text.cpp][godot-loader]).

**Aseprite** und **Pixelorama** bieten Tilemap-Ebenen: Jede Rasterzelle verweist auf eine Kachel eines Tilesets, Index 0 ist leer ([Aseprite: Tilemap][aseprite-tilemap], [Pixelorama 1.1][pixelorama-11]). Aseprite hat zusätzlich einen **Tiled Mode**, der das Bild beim Zeichnen wiederholt und so nahtlose Muster ermöglicht ([Aseprite: Tiled Mode][aseprite-tiled-mode]).

**Autotiling** prüft die Nachbarn einer Zelle, bildet daraus eine Bitmaske und schlägt die passende Kachel nach. Beim Blob-Verfahren zählt eine Ecke nur, wenn beide angrenzenden Seiten belegt sind; so werden aus 256 Kombinationen 47. Ein reines Vier-Nachbarn-Set mit 16 Kacheln kann keine sauberen Innenecken darstellen (Suchergebnisse zu [Red Blob Games][redblob] und [Excalibur][excalibur]).

## Was Pixelator daraus übernimmt

**Tileset als Dokumenteigenschaft statt neuer Ebenenart.** Ein optionales Kachelraster mit Terrain-Set und Kachel-Metadaten hängt am bestehenden Dokument. So bleiben Revisionen, Scope-Regeln, Ebenen, Frames und MCP unverändert nutzbar; Frames animieren die Kacheln. Kachel-IDs folgen dem Raster, deshalb bewegen Größenänderungen nur ganze Kacheln und nehmen die Metadaten mit.

**Terrain-Labels im Tiled-Format plus Zentrum.** Die acht Wang-Positionen werden wörtlich übernommen; ein neunter Wert speichert das Zentrums-Terrain, das Godot verlangt und Tiled nicht kennt. Damit lassen sich beide Formate verlustfrei erzeugen.

**Autotiles aus fünf Schlüsselkacheln.** Statt 47 Kacheln von Hand zu zeichnen, entstehen alle Blob-, Kanten- und Ecken-Kacheln aus den Vierteln von fünf Schlüsselkacheln (einzeln, waagerecht, senkrecht, Kreuzung, Fläche), wie bei RPG-Maker-Autotiles und Aseprites AutoBlob-Erweiterung. Für Ecken-Sets wird um eine halbe Kachel verschoben abgetastet, weil deren Terraingrenzen durch die Kachelmitte laufen. Die erzeugten Kacheln sind sofort gelabelt.

**Prüfen wie in der Engine.** Die Terrain-Testkarte wählt Kacheln mit derselben Regel wie ein Terrain-Pinsel und zeigt fehlende Kombinationen in Magenta. Die Validierung warnt, solange Kombinationen fehlen. Agenten erhalten dieselbe Karte, eine Rasteransicht und eine 3×3-Wiederholung als echte Bilder per MCP.

**Nahtlos zeichnen.** Analog zu Aseprites Tiled Mode laufen Striche und Formen über den Rand weiter, und die Umgebung zeigt die Wiederholung. Ein Versatz um die halbe Größe mit Umlauf (wie ein Offset-Filter) holt Nähte zur Kontrolle in die Mitte.

**Export, den Tiled, Godot und Unity direkt lesen.** Tileset-PNG mit optional wiederholten Kantenpixeln gegen Farbsäume, Tiled TSX/TSJ, Godot-`.tres` und ein Unity-Import-Manifest.

## Bewusst nicht übernommen

**Level-Karten** (Tilemap-Ebenen mit Kachel-Pinsel und Kartenexport) sind ein eigenes Werkzeug. Tiled, LDtk und die Engines leisten das bereits und lesen Pixelators Tilesets direkt. Ebenso offen bleiben Kachelvarianten über Spiegel-Flags, mehrere Terrain-Sets pro Tileset, isometrische und hexagonale Raster sowie Unity-Rule-Tiles. Diese Punkte lassen sich auf dem Datenmodell nachrüsten, wenn ein konkreter Bedarf entsteht.

## Prüfung

Die Exporte wurden nicht nur gegen das Format geschrieben, sondern mit den Werkzeugen selbst geladen; Ergebnisse stehen im [Prüfbericht](../docs/verification.md).
- Godot 4.3 lädt ein erzeugtes Blob-Tileset headless mit allen Metadaten.
- Godots eigener Terrain-Algorithmus (`set_cells_terrain_connect`) wählt in jeder Zelle einer Testform dieselbe Kachel wie Pixelators Testkarte.
- `pytiled-parser` liest TSX und TSJ identisch.

## Quellen

[tiled-json]: https://github.com/mapeditor/tiled/blob/master/docs/reference/json-map-format.rst
[tiled-tmx]: https://github.com/mapeditor/tiled/blob/master/docs/reference/tmx-map-format.rst
[tiled-terrain]: https://github.com/mapeditor/tiled/blob/master/docs/manual/terrain.rst
[tiled-gids]: https://github.com/mapeditor/tiled/blob/master/docs/reference/global-tile-ids.rst
[godot-tileset]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tileset.rst
[godot-atlas]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tilesetatlassource.rst
[godot-tiledata]: https://github.com/godotengine/godot-docs/blob/master/classes/class_tiledata.rst
[godot-source]: https://github.com/godotengine/godot/blob/4.3-stable/scene/resources/2d/tile_set.cpp
[godot-loader]: https://github.com/godotengine/godot/blob/4.3-stable/scene/resources/resource_format_text.cpp
[aseprite-tilemap]: https://github.com/aseprite/docs/blob/main/tilemap.md
[aseprite-tiled-mode]: https://github.com/aseprite/docs/blob/main/tiled-mode.md
[pixelorama-11]: https://orama-interactive.itch.io/pixelorama/devlog/913933/pixelorama-v11-is-out
[redblob]: https://www.redblobgames.com/articles/autotile/
[excalibur]: https://excaliburjs.com/blog/Autotiling%20Technique

- Tiled-Dokumentation: [JSON-Format][tiled-json], [TMX-Format][tiled-tmx], [Terrains][tiled-terrain], [Global Tile IDs][tiled-gids]
- Godot: [TileSet][godot-tileset], [TileSetAtlasSource][godot-atlas], [TileData][godot-tiledata], Quelltext 4.3 [tile_set.cpp][godot-source] und [resource_format_text.cpp][godot-loader]
- Aseprite: [Tilemap][aseprite-tilemap], [Tiled Mode][aseprite-tiled-mode]; Pixelorama: [Devlog v1.1][pixelorama-11]
- Autotiling: [Red Blob Games][redblob], [Excalibur][excalibur]
- Die Websites von Tiled, Aseprite, Pixelorama, Godot, Red Blob Games und Excalibur waren aus der Prüfumgebung wegen der Netzwerkrichtlinie nicht abrufbar. Tiled, Aseprite und Godot wurden über ihre Dokumentations- und Quelltext-Repositories auf GitHub gelesen; Pixelorama-Devlog, Red Blob Games und Excalibur sind über Suchergebnisse belegt.
