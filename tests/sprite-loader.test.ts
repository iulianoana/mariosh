import { describe, it, expect } from 'vitest';
import { parsePalette } from '../src/sprites/palette.js';
import { parseSprite } from '../src/sprites/loader.js';
import type { Palette } from '../src/sprites/palette.js';

describe('parsePalette', () => {
  it('parses a valid 2-line palette', () => {
    const src = [
      'name: nes',
      '---',
      'R: #D82800',
      'K: #000000',
    ].join('\n');
    const p = parsePalette(src);
    expect(p.name).toBe('nes');
    expect(p.colors['R']).toEqual([0xd8, 0x28, 0x00]);
    expect(p.colors['K']).toEqual([0x00, 0x00, 0x00]);
    expect(Object.keys(p.colors)).toHaveLength(2);
  });

  it('rejects a palette missing name', () => {
    const src = ['---', 'R: #D82800'].join('\n');
    expect(() => parsePalette(src)).toThrow(/missing required header 'name'/);
  });

  it('rejects a palette with a bad hex code', () => {
    const src = [
      'name: bad',
      '---',
      'R: #ZZZZZZ',
    ].join('\n');
    expect(() => parsePalette(src)).toThrow(
      /line 3: expected 'CHAR: #RRGGBB'/
    );
  });

  it('rejects 3-digit hex shorthand', () => {
    const src = [
      'name: bad',
      '---',
      'R: #f00',
    ].join('\n');
    expect(() => parsePalette(src)).toThrow(/expected 'CHAR: #RRGGBB'/);
  });

  it('rejects a palette key of "."', () => {
    const src = [
      'name: bad',
      '---',
      '.: #FFFFFF',
    ].join('\n');
    expect(() => parsePalette(src)).toThrow(/reserved for transparent/);
  });

  it('strips inline # comments from header and body lines', () => {
    const src = [
      'name: nes   # default palette',
      '---',
      'R: #D82800   # mario red',
      'K: #000000  # black',
    ].join('\n');
    const p = parsePalette(src);
    expect(p.name).toBe('nes');
    expect(p.colors['R']).toEqual([0xd8, 0x28, 0x00]);
    expect(p.colors['K']).toEqual([0x00, 0x00, 0x00]);
    expect(Object.keys(p.colors)).toHaveLength(2);
  });
});

describe('parseSprite', () => {
  function nesPalette(): Map<string, Palette> {
    const p = parsePalette(
      ['name: nes', '---', 'R: #D82800', 'K: #000000'].join('\n')
    );
    return new Map([[p.name, p]]);
  }

  it('parses a 4x4 sprite with a transparent pixel', () => {
    const palettes = nesPalette();
    const src = [
      '# a sprite',
      'name: tile',
      'size: 4x4',
      'palette: nes',
      '---',
      'RRRR',
      'R..R',
      'R..R',
      'RRRR',
    ].join('\n');
    const sp = parseSprite(src, palettes);
    expect(sp.name).toBe('tile');
    expect(sp.width).toBe(4);
    expect(sp.height).toBe(4);
    expect(sp.palette).toBe('nes');
    expect(sp.pixels).toHaveLength(4);
    expect(sp.pixels[0]).toEqual([
      [0xd8, 0x28, 0x00],
      [0xd8, 0x28, 0x00],
      [0xd8, 0x28, 0x00],
      [0xd8, 0x28, 0x00],
    ]);
    expect(sp.pixels[1][1]).toBeNull();
    expect(sp.pixels[1][2]).toBeNull();
    expect(sp.pixels[1][0]).toEqual([0xd8, 0x28, 0x00]);
  });

  it('rejects a sprite with mismatched row widths', () => {
    const palettes = nesPalette();
    const src = [
      'name: bad',
      'size: 4x4',
      'palette: nes',
      '---',
      'RRRR',
      'RR',
      'RRRR',
      'RRRR',
    ].join('\n');
    expect(() => parseSprite(src, palettes)).toThrow(
      /row width 2 doesn't match declared size 4x4/
    );
  });

  it('rejects a sprite referencing a missing palette', () => {
    const palettes = nesPalette();
    const src = [
      'name: bad',
      'size: 2x2',
      'palette: unknown',
      '---',
      'RR',
      'RR',
    ].join('\n');
    expect(() => parseSprite(src, palettes)).toThrow(
      /declared palette 'unknown' not found/
    );
  });

  it('rejects a sprite using a char not in its palette', () => {
    const palettes = nesPalette();
    const src = [
      'name: bad',
      'size: 2x2',
      'palette: nes',
      '---',
      'RZ',
      'RR',
    ].join('\n');
    expect(() => parseSprite(src, palettes)).toThrow(
      /char 'Z' not in palette 'nes'/
    );
  });

  it('rejects a sprite with too few rows', () => {
    const palettes = nesPalette();
    const src = [
      'name: bad',
      'size: 4x4',
      'palette: nes',
      '---',
      'RRRR',
      'RRRR',
    ].join('\n');
    expect(() => parseSprite(src, palettes)).toThrow(
      /expected 4 body rows, got 2/
    );
  });
});
