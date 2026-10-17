# Pixelorama: Ebenen, Rasteroperationen und Datenerhalt

## Welche Ebenenfunktionen passen unmittelbar zu Pixelator?

### Takeaway
Atomare Ebenenduplikate sind die kleinste sinnvolle Übernahme: Eine Form, Ausstattung oder Schattierung lässt sich unabhängig variieren, während die ursprüngliche Ebene unverändert bleibt. Vollständige Effekte, Gruppen und Mischmodi würden das aktuelle binäre Indexed-Color-Modell deutlich erweitern.

### Cited Findings
- Pixeloramas Klonbefehl kopiert die serialisierten Ebeneneigenschaften und die Bildinhalte der zugehörigen Cels. Die Kopien werden oberhalb der aktuellen Ebene eingefügt und sind Teil einer rückgängig machbaren Aktion. — [Quellcode, Funktion _on_CloneLayer_pressed](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/UI/Timeline/AnimationTimeline.gd#L975-L1040)
- Pixelorama hält Sichtbarkeit, Schreibschutz und Effektzustand separat von Bilddaten. Effekte arbeiten auf einer Bildkopie; das Original bleibt erhalten. — [BaseLayer](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Classes/Layers/BaseLayer.gd#L39-L75), [Effektkopie](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Classes/Layers/BaseLayer.gd#L233-L287)
- Die Dokumentation beschreibt Ebenen als getrennt bearbeitbare Bildteile und Clipping Masks als Sichtbarkeit innerhalb der nichttransparenten Pixel der unteren Ebene. — [Offizielle Ebenendokumentation](https://github.com/Orama-Interactive/Pixelorama-Docs/blob/master/docs/concepts/layer.md)
- Pixelator unterstützt bereits add_layer, remove_layer, update_layer und reorder_layers; diese benötigen vollständigen Scope und allowLayerChanges. Ein eigenes duplicate_layer existiert vor diesem Auftrag nicht. — [Lokale Engine](/C:/Repositories/Pixelator/src/engine.ts), [Operation-Vertrag](/C:/Repositories/Pixelator/src/contracts.ts)

### Inferences
- Empfehlung zur Umsetzung: duplicate_layer mit Quell-layerId sowie neuer id und name; unmittelbar oberhalb der Quelle einfügen, unabhängige Pixelkopie, identische visible- und locked-Werte. Vollständigen Scope, allowLayerChanges, eindeutige ID und das bestehende Limit von 32 Ebenen verlangen. Gleiche Schreibschutzwerte verhindern, dass Duplizieren unbeabsichtigt eine editierbare Kopie geschützter Daten erzeugt.
- Der Import-/Dokumenttyp braucht dafür keine neue gespeicherte Ebeneneigenschaft. Bestehende Revisions- und Undo-Infrastruktur kann die Operation speichern.
- merge-down zunächst zurückstellen: Es vernichtet die semantische Ebenentrennung und hat zusätzliche Fragen bei verborgenen oder geschützten Ebenen.

### Gaps
- Eine quantitative Produktivitätsmessung für Ebenenduplikate liegt in den gelesenen Primärquellen nicht vor.
- Die Live-Website verlinkte während der Recherche eine Dokumentationsroute /Introduction, die 404 lieferte; deshalb wurden die offiziellen Markdown-Quellen verwendet.

## Welche Rasteroperationen bieten den größten unmittelbaren Nutzen?

### Takeaway
Pixelorama trennt beim Füllen die untersuchte Bildreferenz von der bearbeiteten Ebene. Für Pixelator ermöglicht das Füllen einer leeren Farbebene innerhalb einer Kontur auf anderen sichtbaren Ebenen und passt ohne neue Bildformate in die deterministische Engine.

### Cited Findings
- Der Bucket-Code besitzt AREA-, COLORS- und SELECTION-Modi sowie eine Option zum Untersuchen zusammengeführter Ebenen. Für diese Option erstellt er vor dem Füllen Sample-Masks aus dem sichtbaren Ebenenverbund und nutzt diese als Quelle, während Ziel-Cels geändert werden. — [Bucket-Modi](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Bucket.gd#L1-L22), [Sample-Masks](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Bucket.gd#L170-L190), [Referenz und Ziel](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Bucket.gd#L411-L455)
- Pixeloramas globaler Farbfüllmodus bestimmt die Ausgangsfarbe am angeklickten Pixel und berücksichtigt eine Auswahlmaske. — [fill_in_color](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Tools/DesignTools/Bucket.gd#L231-L309)
- Pixelator besitzt bisher einen vierfach zusammenhängenden Fill auf der Zielebene sowie replace für einen bekannten Farbindex. Index 0 bedeutet transparent; der Verbund zeigt jeweils den obersten sichtbaren nichttransparenten Pixel. — [Lokale Engine](/C:/Repositories/Pixelator/src/engine.ts), [Bestehende Regressionstests](/C:/Repositories/Pixelator/tests/engine.test.ts)

### Inferences
- Empfehlung: fill um optionale reference: 'layer' | 'composite' und contiguous: boolean erweitern. Defaults 'layer' und true bewahren vorhandene Befehle. Composite als Snapshot der obersten sichtbaren Indexwerte am Anfang jeder Operation berechnen; versteckte Ebenen ignorieren und Transparenz als 0 behandeln.
- Zusammenhängend bedeutet vier Nachbarn wie bisher; der EditScope begrenzt den Flood-Bereich. Global bedeutet alle gleichen Referenzindizes innerhalb des EditScope. Es werden ausschließlich Pixel der genannten Zielebene geschrieben; lesender Zugriff auf andere Ebenen erweitert den Schreib-Scope nicht.
- Eine wichtige Regression: Wenn der angeklickte Referenzindex bereits der Zielfarbe entspricht, kann auf der Zielebene trotzdem Arbeit nötig sein. Bei Composite-Referenz darf deshalb der alte frühzeitige Abbruch aufgrund identischer Ausgangs- und Zielfarbe nicht gelten.
- Globales Füllen ist für MCP bei reference='layer' funktional ein komfortables, per Klick bestimmtes replace. Der eigentliche Mehrwert liegt in der einheitlichen Browserbedienung und der Composite-Kombination.
- Anti-Aliasing, Toleranz und Shader übernehmen wir nicht: Pixelator arbeitet absichtlich mit exakten existierenden Indizes.

### Gaps
- Pixeloramas UI-Modi sind für Raster-, Tilemap- und Multi-Cel-Betrieb umfassender als der ausgewählte Teil. Die Empfehlung beansprucht keine volle Funktionsgleichheit.

## Was lernen wir über Datenerhalt und Lizenzherkunft?

### Takeaway
Die Stärke besteht in expliziter Trennung von editierbarem Projekt und gerendertem Export sowie in reversiblen Bearbeitungsschritten. Pixelator hat Revisionen und Projektexport bereits; neue Befehle sollten dieselben Garantien nutzen, statt ein zweites Speichersystem einzuführen.

### Cited Findings
- Die offizielle Speicheranleitung unterscheidet das vollständige .pxo-Projekt mit Ebenen, Brushes und Tags vom gerenderten Export und empfiehlt, beides zu verwenden. — [Speichern und Exportieren](https://github.com/Orama-Interactive/Pixelorama-Docs/blob/master/docs/user_manual/save_and_export.md)
- Pixeloramas Project-Klasse besitzt eine UndoRedo-Instanz, serialisiert unter anderem Ebenen, Paletten und Projektversion und deserialisiert ältere Formate mit expliziten Kompatibilitätszweigen. — [Project](https://github.com/Orama-Interactive/Pixelorama/blob/master/src/Classes/Project.gd)
- Pixelator speichert Änderungen als Revisionen; Operationen bearbeiten zunächst eine geklonte Dokumentstruktur und bestätigen erst gültige Ergebnisse. SQLite-Änderungen verwenden Transaktionen. — [Lokale Engine](/C:/Repositories/Pixelator/src/engine.ts), [Lokaler Store](/C:/Repositories/Pixelator/src/store.ts)
- Pixeloramas Repository steht unter der MIT-Lizenz, Copyright 2019–present Orama Interactive and contributors. Bei Kopien oder wesentlichen Softwareteilen verlangt die Lizenz den Copyright- und Erlaubnisvermerk. — [Original-Lizenz](https://github.com/Orama-Interactive/Pixelorama/blob/master/LICENSE)

### Inferences
- Die ausgewählten Funktionen sollten eigenständig in TypeScript implementiert werden. Übernommen werden Bedienkonzept und beobachtetes Verhalten; weder GDScript noch Shader, Icons oder Dokumentationstext werden kopiert. Damit entsteht keine Code-Abhängigkeit und es wird hier kein Fremdcode-Lizenzhinweis als Ersatz für tatsächlich kopierte Bestandteile benötigt.
- Falls später Quellcode oder umfangreiche Teile übernommen werden, Original-Lizenz und Copyright im Distributionspaket erhalten und die konkrete Herkunft dokumentieren. Das ist eine Lesart der oben zitierten MIT-Bedingung, keine juristische Einzelfallprüfung.
- Erforderliche Prüfungen: identische alte Fill-Ergebnisse, voneinander getrennte Farbflächen, Auswahlbegrenzung, Composite mit verdeckenden/verborgenen Ebenen, Transparenz, Ziel-Schreibschutz, unveränderte Quelle beim Duplizieren, unabhängige Kopiedaten, Layer-Limit, Schema-/MCP-Erreichbarkeit und Projektexport/-import der neuen Operationsdaten.

### Gaps
- Automatische externe Backups wurden nicht implementiert oder abschließend beurteilt; SQLite-Revisionen schützen nicht vor Verlust des gesamten Datenverzeichnisses.
- Der gelesene aktuelle master ist veränderlich. Die URLs nennen bewusst konkrete Dateien und Bereiche; dieser Bericht ist eine Recherche vom 17. Oktober 2026.

