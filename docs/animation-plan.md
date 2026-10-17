# Implementierungsplan: KI-Effizienz und Animationen

Stand 17. Oktober 2026 · Basis: Pixelator `c5d051d` · Referenz: Pixelorama [`845de22`](https://github.com/Orama-Interactive/Pixelorama/tree/845de22bd1b7fa43edf3024589a23c3e59c07ba2) (MIT). Der Plan ist umgesetzt; Abschnitt 8 nennt die getroffenen Entscheidungen und Abweichungen, die Prüfergebnisse stehen im [Prüfbericht](verification.md).

## 1. Kurzfazit (Ausgangslage)

- **KI-Assets erstellen: ja, aber noch nicht so effizient wie möglich.** Engine, Scope-Schutz, Revisionen und echte PNG-Inspektion tragen den Agenten-Workflow bereits (realer Codex-Lauf: 32×32-Skelett in 79 s, siehe [Prüfbericht](verification.md)). Die Engpässe liegen beim Datenformat: Raster gehen als JSON-Zahlenlisten hin und her, ein Teilbereich lässt sich nicht kompakt lesen, zwei Zoomstufen brauchen zwei Aufrufe, und jede Bearbeitung liefert den vollen Asset-Kontext zurück.
- **Animationen: nein.** `PixelDocument` kennt genau ein Bild pro Ebene ([types.ts:4](../src/types.ts)). Es gibt keine Frames, Dauern, Tags, Wiedergabe oder Sprite-Sheets; der Skill verbietet ausdrücklich, Animation zu behaupten ([SKILL.md:30](../skills/pixel-artist/SKILL.md)).
- **Empfehlung:** Erst die Effizienz-Grundlagen (Phase 0), dann ein Dokumentmodell v2 mit Frames nach Pixeloramas Vorbild (Phase 1), dann Animation über MCP (Phase 2), danach die Timeline im Editor (Phase 3). So können Agenten Animationen erstellen, bevor die Browser-Timeline fertig ist.

## 2. Ist-Analyse

### 2.1 Architektur

| Modul | Aufgabe |
| --- | --- |
| [`src/engine.ts`](../src/engine.ts) | Deterministische Raster-Engine: Validierung, Komposition, 20 Operationen, Scope-Prüfung, Diff. Wird von Server **und** Browser genutzt (`previewOperations`). |
| [`src/store.ts`](../src/store.ts) | SQLite (`node:sqlite`): Projekte, Assets, unveränderliche Revisionen (Volldokument je Revision), Idempotenz (`requests`), Artist-Runs mit Budget. |
| [`src/mcp.ts`](../src/mcp.ts) | MCP-Server mit 20 Tools und 2 Ressourcen; `inspect_asset` liefert echtes PNG als Bildinhalt. |
| [`src/server.ts`](../src/server.ts) | Fastify: REST für den Editor, SSE-Events, Streamable-HTTP-MCP mit Sitzungs- und Agentenstatus. |
| [`src/images.ts`](../src/images.ts) | PNG-Render (Nearest Neighbor), Thumbnail, verlustfreier PNG-Import, Unity-Metadaten. |
| [`web/App.tsx`](../web/App.tsx) | React-Editor (ein Bauteil, ~480 dichte Zeilen): Werkzeuge, Ebenen, Palette, Verlauf, MCP-Dialog. |
| [`skills/pixel-artist`](../skills/pixel-artist/SKILL.md) | Agenten-Workflow und Artist Guide, über `get_workflow` ausgeliefert. |

### 2.2 Was für KI-Agenten schon gut funktioniert

- Atomare Batches mit bis zu 512 Operationen, Formen (`line`, `rect`, `ellipse`, `polygon`, `fill`, `outline`) statt Einzelpixeln.
- `editScope` mit Ebenen und Rechteck schützt unbeteiligte Pixel; Diff-Prüfung auf Speicher- und Renderebene.
- `expectedRevision` und `requestId` verhindern Überschreiben und Doppelanwendung.
- `inspect_asset` liefert das echte Bild; der Agent bewertet visuell statt anhand von JSON.
- Run-Budget (120 Batches, 1 + 3 Reviews) begrenzt Kosten und Endlosschleifen.

### 2.3 Effizienz-Engpässe (gemessen)

Messung am 17.10.2026 gegen einen In-Memory-Server über MCP-JSON-RPC, synthetisches 32×32-Sprite. Antwortgrößen enthalten Text- **und** `structuredContent`-Kopie (siehe `jsonResult`, [mcp.ts:38](../src/mcp.ts)); welche Kopie das Modell sieht, hängt vom Client ab.

| Aufruf | Zeichen | Befund |
| --- | ---: | --- |
| `tools/list` | 23 512 | Einmalig pro Sitzung; vor allem das Operations-Schema. Akzeptabel, neue Tools sparsam halten. |
| `get_workflow` | 24 475 | Einmalig pro Auftrag; `start_run`/`resume_run` senden den Artist Guide zusätzlich erneut. |
| `patch` 32×32 als JSON-Zahlen | 2 232 | Eingabe des Agenten für einen vollen Ebenenblock. |
| dasselbe als Zeilen-Strings | 1 171 | **−48 % Zeichen**; Tokens voraussichtlich stärker, weil Läufe gleicher Zeichen gut komprimieren (bei Abnahme mit echtem Tokenizer nachmessen). |
| `apply_operations`-Antwort | 3 310 | Voller Asset- und Revisionskontext bei **jedem** Batch, obwohl der Agent meist nur die neue Revision-ID braucht. |
| `get_asset` mit `includePixels` | 7 376 | Ganze Ebenen als Zahlenlisten; kein Bereich, keine einzelne Ebene, keine kompakte Kodierung. |
| `inspect_asset` (Scale 8) | 1 436 + 1 285 | Bild (Base64) plus JSON; effizient. Aber Scale 1 und vergrößert sind laut Skill zwei Aufrufe. |

Weitere Lücken:

1. **Kein kompaktes Lesen eines Ausschnitts.** Für präzise lokale Edits muss der Agent entweder schätzen oder komplette Ebenen laden.
2. **Keine Wiederverwendung von Pixelbereichen über Ebenen hinweg.** `copy` arbeitet nur innerhalb einer Ebene; für Animation (Pose aus Frame 1 übernehmen, verschieben, lokal ändern) ist das der wichtigste Hebel.
3. **Kein Gesamtblick auf zusammengehörige Bilder.** Für Varianten und Frames braucht der Agent ein Kontaktbild statt vieler Einzelinspektionen.

### 2.4 Animation heute

Nicht vorhanden: kein Frame-Begriff in [types.ts](../src/types.ts), [contracts.ts](../src/contracts.ts) oder der Engine; Export nur Einzel-PNG/JSON/Unity-Single-Sprite ([images.ts:71](../src/images.ts)). Ersatzweise ließen sich Frames als getrennte Varianten anlegen, aber ohne gemeinsame Ebenenstruktur, Timing, Tags, Wiedergabe, Sprite-Sheet und mit getrennten Runs/Reviews. Das ist keine Animation, sondern eine Asset-Sammlung.

## 3. Pixelorama als Referenz

Übernommen werden Konzepte und beobachtetes Verhalten, kein GDScript-Code (wie im [bisherigen Bericht](../reports/Pixelorama%20Ideen%20f%C3%BCr%20Pixelator.md)).

| Konzept | Pixelorama | Entscheidung für Pixelator |
| --- | --- | --- |
| Frames und Cels | `Project.frames`, `Project.layers` ([Project.gd:56–57](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Project.gd#L56-L57)); jeder Frame hält pro Ebene ein Cel ([Frame.gd:6](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Frame.gd#L6)). | Gleiche Struktur: Ebenen global, `frames[].cels[layerId]`. Semantische Ebenen (`body`, `sword`) bleiben über alle Frames konsistent. |
| Timing | Projekt-`fps` plus Dauer-Multiplikator je Frame ([Frame.gd:7,16](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Frame.gd#L7-L17), [Project.gd:82](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Project.gd#L82)). | `durationMs` pro Frame. Engine-neutral, direkt für Aseprite-JSON, Unity und Godot nutzbar; keine Umrechnung bei FPS-Änderung. |
| Tags | Name, Farbe, `from`/`to` 1-basiert inklusive ([AnimationTag.gd:42–45](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/AnimationTag.gd#L42-L45)). | Indexbasiert, aber **0-basiert** inklusive, plus `direction` und `loop`. Farbe nur im UI abgeleitet. |
| Tag-Anpassung | Einfügen innerhalb/direkt hinter einem Tag verlängert ihn, davor verschiebt ihn; Löschen des einzigen Frames entfernt den Tag (`undo_redo_add_frames`, `delete_frames`, [AnimationTimeline.gd:432, 478](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L432)). | Identische Regeln in der Engine, durch Tests festgeschrieben. |
| Frame kopieren | Kopie direkt hinter der Quelle, gleiche Dauer, Cels tief kopiert oder verlinkt ([AnimationTimeline.gd:549](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L549)). | `duplicate_frame` mit tiefer Kopie. Verlinkte Cels (`link_set`, [BaseCel.gd:17](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Classes/Cels/BaseCel.gd#L17)) erst in Phase 4. |
| Wiedergabe | Loop `NO`/`CYCLE`/`PINGPONG`, vorwärts/rückwärts, optional nur aktueller Tag ([AnimationTimeline.gd:13, 804, 877](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Timeline/AnimationTimeline.gd#L804)). | Gleiches Verhalten als reine Funktion in `web/animation-helpers.ts`. |
| Onion Skin | Vorherige/folgende Frames mit `opacity / i`, Blau/Rot-Modus, Ebenen per `ignore_onion` ausnehmbar ([OnionSkinning.gd:29–37](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/UI/Canvas/OnionSkinning.gd#L29-L37)). | Im Editor als reine Ansicht; zusätzlich im MCP-`inspect_asset` als Overlay für den Agenten. |
| Export | Sprite-Sheet nach Spalten/Zeilen/Tags, Richtung vorwärts/rückwärts/Ping-Pong, Formate inkl. GIF/APNG ([Export.gd:4–8, 219](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Autoload/Export.gd#L219)). JSON-Export ist das interne Projektformat ([Export.gd:583](https://github.com/Orama-Interactive/Pixelorama/blob/845de22bd1b7fa43edf3024589a23c3e59c07ba2/src/Autoload/Export.gd#L583)). | Sheet-PNG plus **Aseprite-kompatibles JSON** (von vielen Engines/Importern gelesen) und Unity-Metadaten mit mehreren Sprites. GIF in Phase 4. |
| Nicht übernommen | Cel-Opazität, Z-Index, Blend-Modi, Gruppen-, 3D-, Audio- und Tilemap-Ebenen. | Passt nicht zum binären Alpha-Indexraster; kein Produktziel. |

## 4. Zielbild

### 4.1 Dokumentmodell v2

```ts
export interface PixelLayer { id: string; name: string; visible: boolean; locked: boolean }
export interface PixelFrame {
  id: string;                       // Bezeichner wie Ebenen-IDs, z. B. "walk_1"
  durationMs: number;               // Ganzzahl 10..60000
  cels: Record<string, number[]>;   // Schlüssel = layer.id, Länge width*height
}
export interface AnimationTag {
  name: string;                     // eindeutig
  from: number; to: number;         // 0-basiert, inklusive
  direction: 'forward' | 'reverse' | 'pingpong';
  loop: boolean;
}
export interface PixelDocument {
  schemaVersion: 2;
  width: number; height: number;
  palette: string[]; maxColors: number; paletteLocked: boolean;
  layers: PixelLayer[];             // unten → oben, für alle Frames gleich
  frames: PixelFrame[];             // ≥ 1, Abspielreihenfolge
  tags: AnimationTag[];
  pivot: { x: number; y: number };  // gemeinsam für alle Frames (stabiler Ankerpunkt)
}
/** Ein Frame in bisheriger v1-Form. Eingabe für Zeichenoperationen und Renderer. */
export interface FrameView {
  width: number; height: number; palette: string[];
  layers: (PixelLayer & { pixels: number[] })[];
}
```

Ein Einzelbild ist ein Dokument mit einem Frame. Es gibt also **einen** Codepfad, keine Sonderbehandlung „animiert/nicht animiert“.

**Invarianten** (in `validateStructure`): 1–64 Frames mit eindeutigen IDs; jeder Frame hat Cels für genau die Ebenen-ID-Menge; jede Cel hat `width*height` gültige Indizes; `durationMs` ganzzahlig im Bereich; Tags eindeutig benannt, `0 ≤ from ≤ to < frames.length`, höchstens 32.

**ValidationReport v2:** `colorCount` über alle Frames, `opaquePixels` als Summe, `boundingBox` als Vereinigung (nützlich für Trimmen), neu `frames: { frameId, opaquePixels, boundingBox }[]` und Warnung `EMPTY_FRAME`.

**PixelDiff v2:** zusätzlich `changedFrames: string[]`; `changedPixels` zählt geänderte (Frame, Position)-Paare.

### 4.2 Frame-Auflösung und EditScope

```ts
export interface EditScope {
  layerIds: string[]; rect?: Rect;
  frameIds?: string[];            // neu; fehlt = alle Frames beschreibbar
  allowPaletteChanges?: boolean; allowLayerChanges?: boolean;
  allowFrameChanges?: boolean;    // neu; Frame-, Timing- und Tag-Struktur
}
```

- Jede Rasteroperation erhält optional `frameId`. Auflösung: `op.frameId` → einziger Eintrag in `editScope.frameIds` → einziger Frame des Dokuments → sonst Fehler `FRAME_REQUIRED`. Bestehende Aufrufe auf Einzelbildern bleiben damit gültig.
- Der Diff prüft Änderungen pro (Frame, Ebene, Position) gegen den Scope. Ein Frame außerhalb von `frameIds` bleibt nachweislich unverändert (`SCOPE_VIOLATION`).
- Paletten- und Ebenenstrukturänderungen wirken auf alle Frames und verlangen daher zusätzlich, dass `frameIds` fehlt oder alle Frames enthält.
- Frame-Strukturoperationen verlangen `allowFrameChanges`, kein `rect` und die betroffenen Frames im Scope.

### 4.3 Neue Operationen

| Operation | Felder | Verhalten |
| --- | --- | --- |
| `rows` *(Phase 0)* | `layerId, frameId?, x, y, rows: string[], mode?: 'replace' \| 'over'` | Kompakter Patch. Alphabet: `.` = 0 (transparent), `1`–`9`, `a`–`w` = Index 1–32. `over` lässt `.` den Bestand behalten. |
| `stamp` | `layerId, frameId?, sourceLayerId?, sourceFrameId?, rect?, dx, dy, mode?: 'over' \| 'replace'` | Bereich aus beliebiger Ebene/beliebigem Frame desselben Dokuments kopieren und versetzen. Kernoperation für Posen-Wiederverwendung. Clipping-Regeln wie `move`. |
| `add_frame` | `id, index?, durationMs?` | Leere Cels für alle Ebenen; Standard: ans Ende, 100 ms. |
| `duplicate_frame` | `frameId, id, index?` | Tiefe Kopie aller Cels und der Dauer; Standard direkt hinter der Quelle. |
| `remove_frame` | `frameId` | Nicht der letzte Frame. |
| `reorder_frames` | `frameIds` | Vollständige Permutation; Tags bleiben positionsbasiert. |
| `frame_duration` | `frameIds, durationMs` | Timing mehrerer Frames in einer Operation. |
| `set_tags` | `tags: AnimationTag[]` | Ersetzt die Tag-Liste atomar. |

Bestehende Rasteroperationen bekommen nur `frameId?`. `add_layer`, `duplicate_layer` und `remove_layer` wirken auf alle Frames (neue Cels leer bzw. kopiert). Tag-Anpassung bei Einfügen/Löschen nach den Pixelorama-Regeln aus Abschnitt 3.

**Umsetzungsprinzip in der Engine:** `editDocument` bleibt die einzige Bearbeitungsfunktion. Rasteroperationen laufen über `frameView(doc, frameId)` und schreiben in die Cels zurück. Die vorhandenen ~300 Zeilen Zeichenlogik bleiben inhaltlich unverändert.

### 4.4 Rendering und Export

- `composite(doc, frameId?)`, `renderPng(doc, scale, frameId?)`; Thumbnail nutzt den ersten Frame.
- `renderSheet(doc, { frameIds?, tag?, columns?, scale, gutter?, onion? })` liefert PNG und Layout (`frameId, x, y, w, h, durationMs` je Zelle).
- **Export `sheet`:** Sheet-PNG (Standard ohne Abstand) plus JSON im Aseprite-„Array“-Format: `frames[]` mit `frame`-Rechteck und `duration`, `meta.size`, `meta.frameTags` (`name`, `from`, `to`, `direction`), Erweiterung `meta.pivot`.
- **Export `unity`:** bei mehreren Frames `spriteMode: 'Multiple'`, Sprite-Rechtecke mit Ursprung unten links, normierter Pivot, `clips[]` je Tag mit Sprite-Namen, Dauern und Loop. Wie bisher nur Metadaten, kein Eingriff in ein Unity-Projekt.
- **Export `png`:** einzelner Frame über `frameId`, Standard erster Frame.

### 4.5 MCP-Schnittstelle

Nur ein neues Tool; alles andere erweitert bestehende Tools.

| Tool | Änderung |
| --- | --- |
| `read_pixels` *(neu, Phase 0)* | `assetId, revisionId?, frameId?, layerId?` (fehlt = sichtbares Gesamtbild), `rect?` → `rows` im Alphabet von `rows`, dazu Legende (Index → Hex). Höchstens 16 384 Zellen pro Aufruf. Ersetzt `includePixels` für den Normalfall. |
| `apply_operations` | Neue Operationen und Scope-Felder. Antwort standardmäßig **kompakt**: `assetId, revisionId, parentId, diff, validation` (ohne Dokument), `frames` (IDs, Dauern), `layers` (IDs). `response: 'full'` liefert das bisherige Format. |
| `inspect_asset` | `scales?: number[]` (bis 3 Bilder in einem Aufruf, Phase 0). Neu: `frameId?`, `layout?: 'frame' \| 'sheet'`, `frameIds?`, `tag?`, `columns?`, `onion?: { before?: 0..3, after?: 0..3 }`. Bei mehreren Frames ist `sheet` Standard: **ein** Bild mit allen Frames, getrennt durch eine Trennfarbe außerhalb der Palette; Layout im JSON. Onion-Frames als feste Tönung (vorher Blau, nachher Rot) unter dem Ziel-Frame. |
| `create_asset` | Optional `frames: { id, durationMs? }[]` und `tags`. |
| `get_asset` | Zusammenfassung mit Frames, Dauern und Tags; `includePixels` bleibt kompatibel, optional mit `frameIds`. |
| `export_asset` | Formate `png` (mit `frameId`), `json`, `unity`, `sheet` (schreibt PNG und JSON nebeneinander), später `gif`. |
| `get_workflow` | Limits um `frames: 64`, `tags: 32` ergänzt. |
| Runs | `inspected` speichert zusätzlich die gezeigten Frame-IDs. `finish_run('completed')` verlangt bei Animationen eine Inspektion, die alle Frames abdeckt. |

**Warum Sheet statt GIF für den Agenten:** MCP-Bildinhalt wird von Vision-Modellen als Standbild verarbeitet; ein animiertes GIF zeigt dem Modell in der Regel nur einen Frame. Ein Kontaktbild zeigt Bewegung, Silhouette pro Frame und Ankerstabilität auf einen Blick.

**Effizienter Animations-Ablauf für Agenten** (kommt in den Skill): Schlüsselpose in Frame 1 zeichnen → `duplicate_frame` → per `stamp`/`move` auf Ebenen verschieben → mit `rows` lokal korrigieren → `inspect_asset` als Sheet mit Onion → Review → Timing per `frame_duration` → `set_tags` → Export `sheet`.

### 4.6 Web-Editor

- **Neue Datei `web/Timeline.tsx`:** Frame-Miniaturen, aktueller Frame, Dauer-Eingabe in ms, Frame hinzufügen/duplizieren/löschen/verschieben, Tag-Leiste über den Frames mit Dialog (Name, Bereich, Richtung, Loop), Abspielen/Pause, Loop-Modus (einmal/Zyklus/Ping-Pong), „nur aktuellen Tag“, Onion-Schalter (vorher/nachher 0–3).
- **Neue Datei `web/animation-helpers.ts`:** reine Funktionen für Wiedergabebereich, nächsten Frame (alle Loop-Modi, beide Richtungen), Onion-Auswahl und Tag-Layout. Unit-getestet wie `view-helpers.ts`.
- **`web/App.tsx`:** nur Zustandsverdrahtung: `frameId`; alle Operationen mit `frameId` und `editScope.frameIds`; Pipette, Ebenenminiaturen und Auswahl-Patch lesen den aktuellen Frame; Onion-Canvas unter der Zeichenfläche (`pointer-events: none`, keine Dokumentänderung). Kopierter Agentenauftrag nennt Frame und Tag.
- **`web/AssetPreview.tsx`:** spielt die Animation mit echten Dauern ab, unabhängig vom bearbeiteten Frame (wie Pixeloramas Vorschau); 3×3-Kachelung bleibt.
- **Tastenkürzel** (`resolveShortcut`): `,` / `.` vorheriger/nächster Frame, `K` Abspielen/Pause, `Umschalt+O` Onion Skin.

### 4.7 Migration und Kompatibilität

- `upgradeDocument()` (rein, in der Engine): v1 → v2 mit einem Frame `frame-1`, 100 ms, ohne Tags; Pixel unverändert in die Cels.
- **Kein Umschreiben der Datenbank.** Gelesene Revisionen werden beim Lesen angehoben, neue Revisionen als v2 gespeichert. Gilt auch für gespeicherte Replay-Antworten in `requests` ([store.ts:205](../src/store.ts)), damit Wiederholungen keine v1-Form liefern.
- Projektimport akzeptiert Bundles mit `schemaVersion` 1 und 2 und Dokumente v1 und v2; Export schreibt Version 2.
- REST/MCP-Clients sehen die neue Form. Agenten lesen Schemas dynamisch; Skill und Artist Guide werden in derselben Phase aktualisiert.

## 5. Phasen

Aufwand als grobe Größe (S/M/L). Jede Phase endet mit grünem `npm run typecheck`, `npm test`, `npm run build` und ist einzeln auslieferbar.

### Phase 0 – Effizienz für alle Assets (S–M)

1. `rows`-Operation: Vertrag in `contracts.ts`/`types.ts`, Engine-Fall neben `patch`.
2. `read_pixels`-Tool in `mcp.ts`, Kodierer/Dekodierer als gemeinsame Hilfsfunktion in `src/engine.ts` (oder `src/raster-text.ts`).
3. `inspect_asset` mit `scales[]` (mehrere Bildinhalte in einer Antwort).
4. Kompakte `apply_operations`-Antwort mit `response: 'full'` als Ausweg.
5. Skill: `rows`, `read_pixels` und `scales` im Workflow verwenden; Beispiel mit `rows` statt `patch`.

**Akzeptanz:** `rows` und `patch` erzeugen identische Dokumente; `read_pixels` → `rows` ist verlustfrei; zwei Scales in einem Aufruf; kompakte Antwort enthält die neue Revision-ID und kein Dokument. Messung aus Abschnitt 2.3 wiederholen und Ergebnis in [verification.md](verification.md) eintragen.

### Phase 1 – Dokumentmodell v2 und Engine (L)

Empfohlene Commit-Reihenfolge, damit jeder Schritt prüfbar bleibt:

1. Typen, Schema (`documentSchema` als Union v1/v2), `upgradeDocument`, `frameView`; Test-Hilfsfunktion `cel(doc, layerId, frameIndex = 0)`. Alle Tests mechanisch umstellen (rund 70 Zugriffe auf `.pixels` in `tests/`), **ohne Verhaltensänderung**.
2. Engine: Frame-Auflösung, Scope (`frameIds`, `allowFrameChanges`), Diff und Validierung pro Frame.
3. Frame-Operationen inklusive Tag-Anpassung; `stamp`.
4. Store: Anheben beim Lesen inkl. Replay, `createDocument` mit Frames, Import/Export Bundle v2, `importDocument`-Leerprüfung über alle Frames.
5. Renderer: `composite`/`renderPng` mit `frameId`; Editor zeigt vorerst Frame 1 (keine Timeline), damit nichts bricht.

**Tests (`tests/engine.test.ts`, `tests/store.test.ts`):** v1 → v2 verlustfrei; eine roh gespeicherte v1-Revision und eine v1-Replay-Antwort werden als v2 gelesen; v1-Projektbundle importierbar; jede Frame-Operation inkl. Grenzen und atomarem Rollback; Tag-Regeln (Einfügen in/hinter/vor Tag, Löschen des einzigen Tag-Frames); `FRAME_REQUIRED`; Schreibversuch auf Frame außerhalb des Scopes; `stamp` über Frames/Ebenen in beiden Modi und mit Clipping; Palette und gesperrte Ebenen über alle Frames; `changedFrames`; `EMPTY_FRAME`.

**Akzeptanz zusätzlich:** Revisionsgröße für 8 Frames × 4 Ebenen × 32×32 messen und dokumentieren (Erwartung grob 70 kB JSON pro Revision).

### Phase 2 – Animation über MCP (M)

1. `create_asset` mit Frames/Tags; `get_asset`-Zusammenfassung; `read_pixels` mit `frameId`.
2. `renderSheet` mit Trennfarbe und Onion; `inspect_asset` mit Sheet/Frame/Onion; Run-Abdeckung aller Frames.
3. Export `sheet` (PNG + Aseprite-JSON), Unity mit mehreren Sprites und Clips, `png` pro Frame; REST: `/api/assets/:id/png?frameId=`, `/api/assets/:id/export?format=sheet|sheet-json`.
4. Skill und Artist Guide: Animationsablauf aus 4.5; neue Review-Kategorie **Motion** (Loop-Übergang letzter → erster Frame, Timing, Ankerstabilität am Pivot, Silhouette pro Frame, kein unbeabsichtigtes Pixelflimmern). Belegquellen für Animationsregeln bei der Umsetzung recherchieren und wie im bestehenden Guide verlinken. Den Satz „Animation … later extensions“ entfernen.
5. `docs/mcp.md` und README-Stichpunkt kurz ergänzen (gemäß AGENTS.md).

**Tests (`tests/server.test.ts`, `tests/images.test.ts`):** MCP-Durchlauf 4-Frame-Asset anlegen → `duplicate_frame` + `stamp` → `inspect_asset` liefert genau ein Bild mit erwarteter Breite (`n·w·scale` plus Trennlinien); Onion färbt nur Nachbarframes; `finish_run('completed')` ohne Abdeckung aller Frames abgelehnt; Sheet-PNG pixelgenau gleich den Einzelframes; JSON-Rechtecke, Dauern und Tags korrekt; Unity-Rechtecke mit gespiegelter y-Achse.

**Reale Abnahme** (in [testing.md](testing.md) aufnehmen, Ergebnis in [verification.md](verification.md)): 32×32-Skelett mit 4-Frame-Idle und 6-Frame-Walk, Tags `idle`/`walk`; Füße bleiben am Pivot; Sheet und JSON in einer Engine importieren. Mit Codex und Claude getrennt prüfen; Batch-Verbrauch gegen das Run-Budget festhalten.

### Phase 3 – Timeline im Editor (L)

Dateien und Verhalten wie in 4.6. **Tests:** `tests/animation-helpers.test.ts` (Zyklus, Ping-Pong, einmalig, rückwärts, nur Tag, Onion-Auswahl an Rändern), Kürzel in `tests/view-helpers.test.ts`, Vorschau in `tests/asset-preview.test.ts`. **Browserabnahme:** Frames anlegen/duplizieren/verschieben/löschen inkl. Undo/Redo, Zeichnen trifft nur den aktuellen Frame, Onion verändert keine Daten, Wiedergabe mit echten Dauern, externe Agentenänderung an einem anderen Frame erscheint live.

### Phase 4 – Erweiterungen (je S–M, nach Bedarf)

- GIF-Export (Indexpalette ≤ 32 Farben und binäre Transparenz passen direkt zu GIF): kleine Abhängigkeit wie `gifenc` oder eigener LZW-Encoder; Entscheidung bei Umsetzung.
- Sprite-Sheet-PNG-Import mit Zellgröße → Frames.
- Verlinkte Cels für statische Ebenen (Pixelorama `link_set`, `new_cels_linked`): einmal bearbeiten, in allen verlinkten Frames wirksam; spart Speicher.
- Speicher-Kompaktierung der Cels (z. B. Base64/RLE nur in SQLite, API unverändert), falls die Messung aus Phase 1 es verlangt.
- Godot-`SpriteFrames`-Export; `stamp` aus einem anderen Asset gleicher Palette für Asset-Familien.

## 6. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
| --- | --- |
| Revisionen speichern das Volldokument; Frames vervielfachen die Größe. | Phase-1-Messung; Frame-Limit 64; Kompaktierung oder verlinkte Cels in Phase 4. |
| Formänderung des Dokuments bricht REST-/MCP-Clients. | `schemaVersion`, Anheben beim Lesen, Import beider Versionen, Skill-Update in derselben Phase. |
| Große Testumstellung verdeckt Verhaltensfehler. | Umstellung als eigener Commit ohne Verhaltensänderung, danach erst neue Funktionen. |
| `App.tsx` wird unübersichtlich. | Timeline und Wiedergabelogik in eigene Dateien, App nur Verdrahtung. |
| Run-Budget (120 Batches) reicht für viele Frames nicht. | In der realen Abnahme messen; erst dann ggf. Budget an Frame-Anzahl koppeln. |
| Kompakte Antwort als Standard überrascht bestehende Agenten. | `response: 'full'`; Skill nennt den Wechsel; `get_asset` liefert alles Weitere. |

## 7. Offene Entscheidungen (mit Empfehlung)

1. **Timing:** `durationMs` pro Frame *(empfohlen)* oder FPS × Multiplikator wie Pixelorama.
2. **Tags:** indexbasiert wie Pixelorama/Aseprite *(empfohlen)* oder an Frame-IDs gebunden.
3. **`apply_operations`-Antwort:** kompakt als Standard *(empfohlen)* oder nur auf Wunsch.
4. **GIF:** kleine Abhängigkeit *(empfohlen, weniger Code)* oder eigener Encoder.
5. **Frame-Limit:** 64 *(empfohlen für V1)*.

Pixeloramas MIT-Lizenz bleibt als Herkunft der untersuchten Konzepte dokumentiert; es wird kein Pixelorama-Code, Shader oder Asset kopiert.

## 8. Umsetzungsstand

Phasen 0 bis 3 sind vollständig umgesetzt, aus Phase 4 GIF-Export, Sprite-Sheet-Import und eine Speicher-Kompaktierung.

**Entscheidungen zu Abschnitt 7:** Dauer in ms pro Frame; indexbasierte Tags mit Pixeloramas Einfüge-/Löschregeln; kompakte `apply_operations`-Antwort als Standard; Frame-Limit 64. Beim GIF fiel die Wahl abweichend von der Empfehlung auf einen eigenen GIF89a-Encoder (rund 60 Zeilen): Indexpaletten mit höchstens 33 Einträgen und binärer Transparenz passen direkt zu GIF, eine Abhängigkeit entfällt, und ein unabhängiger Decoder (Pillow) bestätigt das Ergebnis.

**Abweichungen und Ergänzungen gegenüber dem Plan:**

- `create_asset` nimmt Animations-Tags als `animationTags`, weil `tags` dort bereits die Suchbegriffe des Assets sind.
- Unity-Metadaten sind in `unityManifest` (Einzelbild) und `unitySheetManifest` (Sheet mit Sprites und Clips) getrennt.
- `inspect_asset` legt Sheets standardmäßig mit höchstens 8 Spalten an, damit das Prüfbild für Vision-Modelle kompakt bleibt; der Export nutzt einen horizontalen Streifen.
- `stamp` liest andere Ebenen und Frames ohne Schreib-Scope, wie die Gesamtbild-Referenz beim Füllen. Frame-Struktur ignoriert Ebenensperren wie Pixelorama: Sperren schützen das Zeichnen in vorhandenen Frames.
- Speicher: Die Messung zeigte, dass jede Replay-Antwort das Volldokument doppelt speicherte. Replay-Einträge enthalten nun nur Revisions-ID und Diff; das halbiert den Speicher pro Revision. Cel-Kompaktierung und verlinkte Cels sind bei rund 70 KB pro Revision (8 Frames × 4 Ebenen × 32×32) nicht nötig.
- Sprite-Sheet-Import: REST-Parameter `frameWidth`/`frameHeight` für beliebige Raster; der Editor erkennt Streifen quadratischer Zellen und fragt nach.
- Die Server-Tests geben dem Mock-Socket von light-my-request das `destroySoon` echter Sockets; ohne das stürzten längere MCP-Tests über einen Drain-Timer des MCP-Transports ab (vorbestehend, im Betrieb ohne Wirkung).

**Offen:** verlinkte Cels, Godot-`SpriteFrames`-Export, `stamp` aus anderen Assets, reale Agenten-Abnahme der Animationsaufgaben 21–23 und der Import der Exporte in einer echten Engine.
