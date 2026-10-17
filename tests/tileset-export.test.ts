import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { applyOperations, createDocument } from '../src/engine.js';
import { animatedTiles, godotTileset, renderTilesetImage, tiledTileset, tiledTilesetXml, tilesetLayout, unityTilesetManifest } from '../src/tileset-export.js';
import type { EditScope, Operation, PixelDocument } from '../src/types.js';

const palette = ['#00000000', '#FF0000', '#00FF00'];
const scope = (doc: PixelDocument): EditScope => ({ layerIds: doc.layers.map(layer => layer.id), allowLayerChanges: true, allowFrameChanges: true });
const run = (doc: PixelDocument, operations: Operation[]) => applyOperations(doc, operations, scope(doc)).document;
/** 2×1 tiles of 2×2 px: tile 0 red with a grass label and collision, tile 1 animated green/red over two frames. */
function sample() {
  let doc = createDocument({ width: 4, height: 2, palette, tileSize: { width: 2, height: 2 }, frames: [{ id: 'a', durationMs: 120 }, { id: 'b', durationMs: 80 }] });
  doc = run(doc, [
    { op: 'rows', layerId: 'base', frameId: 'a', x: 0, y: 0, rows: ['1122', '1122'] }, { op: 'rows', layerId: 'base', frameId: 'b', x: 0, y: 0, rows: ['1111', '1111'] },
    { op: 'tileset', terrainMode: 'mixed', terrains: [{ name: 'Gras', color: '#33CC33' }] },
    { op: 'tile_properties', tiles: [{ id: 0, name: 'Wand "Nord"', type: 'wall', probability: 0.5, collision: [{ x: 0, y: 1, width: 2, height: 1 }], terrain: [1, 1, 1, 0, 0, 0, 0, 0, 1] }] },
  ]);
  return doc;
}

describe('tileset export', () => {
  it('finds animated tiles and stacks their frames as further rows', () => {
    const doc = sample();
    expect(animatedTiles(doc)).toEqual([1]);
    expect(tilesetLayout(doc)).toMatchObject({ columns: 2, rows: 1, frames: 2, tilesPerFrame: 2, tileCount: 4, imageWidth: 4, imageHeight: 4, margin: 0, spacing: 0, animated: [1] });
    const still = run(sample(), [{ op: 'remove_frame', frameId: 'b' }]);
    expect(tilesetLayout(still)).toMatchObject({ frames: 1, tileCount: 2, imageHeight: 2 });
  });

  it('extrudes tile edges into margin and spacing', () => {
    const { png, layout } = renderTilesetImage(sample(), { extrude: 1, spacing: 2 });
    expect(layout).toMatchObject({ margin: 1, spacing: 4, imageWidth: 10, imageHeight: 10 });
    const image = PNG.sync.read(png);
    const pixel = (x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(4, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(7, 1)).toEqual([0, 255, 0, 255]);
    expect(pixel(7, 7)).toEqual([255, 0, 0, 255]);
    expect(() => tilesetLayout(sample(), { extrude: 5 })).toThrow('Extrude');
    expect(() => tilesetLayout(createDocument({ width: 2, height: 2 }))).toThrow('Kachelraster');
  });

  it('writes Tiled tilesets with properties, collision objects, animations and a Wang set', () => {
    const doc = sample(); const layout = tilesetLayout(doc);
    const tsj = tiledTileset(doc, 'Wald', 'Wald.tileset.png', layout);
    expect(tsj).toMatchObject({ type: 'tileset', version: '1.10', image: 'Wald.tileset.png', tilewidth: 2, tileheight: 2, tilecount: 4, columns: 2, imagewidth: 4, imageheight: 4 });
    expect(tsj.tiles).toEqual([
      { id: 0, type: 'wall', probability: 0.5, properties: [{ name: 'name', type: 'string', value: 'Wand "Nord"' }], objectgroup: { draworder: 'index', id: 2, name: '', objects: [{ id: 1, name: '', type: '', rotation: 0, visible: true, x: 0, y: 1, width: 2, height: 1 }], opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 } },
      { id: 1, animation: [{ tileid: 1, duration: 120 }, { tileid: 3, duration: 80 }] },
    ]);
    expect(tsj.wangsets).toEqual([{ name: 'Terrain', type: 'mixed', tile: -1, colors: [{ name: 'Gras', color: '#33CC33', probability: 1, tile: -1 }], wangtiles: [{ tileid: 0, wangid: [1, 1, 1, 0, 0, 0, 0, 0] }] }]);
    const tsx = tiledTilesetXml(doc, 'Wald', 'Wald.tileset.png', layout);
    expect(tsx).toContain('<tileset version="1.10" tiledversion="1.11.2" name="Wald" tilewidth="2" tileheight="2" spacing="0" margin="0" tilecount="4" columns="2">');
    expect(tsx).toContain('<property name="name" value="Wand &quot;Nord&quot;"/>');
    expect(tsx).toContain('<frame tileid="3" duration="80"/>');
    expect(tsx).toContain('<wangtile tileid="0" wangid="1,1,1,0,0,0,0,0"/>');
  });

  it('writes a Godot 4 TileSet with terrain bits, physics polygons, custom data and animation rows', () => {
    const tres = godotTileset(sample(), 'Wald.tileset.png', tilesetLayout(sample())).split('\n');
    expect(tres[0]).toBe('[gd_resource type="TileSet" load_steps=3 format=3]');
    expect(tres).toContain('[ext_resource type="Texture2D" path="Wald.tileset.png" id="1_texture"]');
    expect(tres).toEqual(expect.arrayContaining([
      'texture_region_size = Vector2i(2, 2)', '0:0/0 = 0', '0:0/0/probability = 0.5', '0:0/0/terrain_set = 0', '0:0/0/terrain = 0',
      '0:0/0/terrains_peering_bit/top_side = 0', '0:0/0/terrains_peering_bit/top_right_corner = 0', '0:0/0/terrains_peering_bit/right_side = 0',
      '0:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-1, 0, 1, 0, 1, 1, -1, 1)', '0:0/0/custom_data_0 = "Wand \\"Nord\\""', '0:0/0/custom_data_1 = "wall"',
      '1:0/animation_columns = 1', '1:0/animation_separation = Vector2i(0, 0)', '1:0/animation_frame_0/duration = 0.12', '1:0/animation_frame_1/duration = 0.08', '1:0/0 = 0',
      'tile_size = Vector2i(2, 2)', 'physics_layer_0/collision_layer = 1', 'terrain_set_0/mode = 0', 'terrain_set_0/terrain_0/name = "Gras"', 'terrain_set_0/terrain_0/color = Color(0.2, 0.8, 0.2, 1)',
      'custom_data_layer_0/name = "name"', 'custom_data_layer_0/type = 4', 'custom_data_layer_1/name = "type"', 'sources/0 = SubResource("TileSetAtlasSource_1")',
    ]));
    expect(tres.indexOf('1:0/animation_frame_1/duration = 0.08')).toBeLessThan(tres.indexOf('1:0/0 = 0'));
  });

  it('describes tiles for Unity at one unit per tile with bottom-left rectangles', () => {
    const doc = sample(); const manifest = unityTilesetManifest('asset', 'rev', 'Wald', doc, 'Wald.tileset.png', tilesetLayout(doc));
    expect(manifest).toMatchObject({ pixelsPerUnit: 2, textureWidth: 4, textureHeight: 4, textureImporter: { spriteMode: 'Multiple', filterMode: 'Point' } });
    expect(manifest.sprites[0]).toEqual({ name: 'Wald_0', rect: { x: 0, y: 2, width: 2, height: 2 }, pivot: { x: 0.5, y: 0.5 } });
    expect(manifest.animatedTiles).toEqual([{ tile: 'Wald_1', frames: [{ sprite: 'Wald_1', durationMs: 120 }, { sprite: 'Wald_3', durationMs: 80 }] }]);
    expect(manifest.tiles).toEqual([{ sprite: 'Wald_0', name: 'Wand "Nord"', type: 'wall', collision: [{ x: 0, y: 0, width: 2, height: 1 }] }]);
  });
});
