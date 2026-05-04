import { describe, expect, it } from 'vitest';
import { Framebuffer, type RGB } from '../src/engine/framebuffer.js';
import { Renderer } from '../src/engine/renderer.js';

describe('Framebuffer', () => {
  it('initializes to black', () => {
    const fb = new Framebuffer(4, 4);
    const px = fb.getPixels();
    expect(px.length).toBe(4);
    expect(px[0]!.length).toBe(4);
    expect(px[0]![0]).toEqual([0, 0, 0]);
    expect(px[3]![3]).toEqual([0, 0, 0]);
  });

  it('fill, setPixel, and blit with transparency compose correctly', () => {
    const fb = new Framebuffer(4, 4);
    const RED: RGB = [255, 0, 0];
    const GREEN: RGB = [0, 255, 0];
    const BLUE: RGB = [0, 0, 255];
    const WHITE: RGB = [255, 255, 255];

    fb.fill(RED);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(fb.getPixels()[y]![x]).toEqual(RED);
      }
    }

    fb.setPixel(2, 1, GREEN);
    expect(fb.getPixels()[1]![2]).toEqual(GREEN);
    // Out of bounds is a no-op.
    fb.setPixel(-1, 0, WHITE);
    fb.setPixel(0, 99, WHITE);
    expect(fb.getPixels()[0]![0]).toEqual(RED);

    // 2x2 sprite with one transparent pixel (top-right).
    const sprite: ReadonlyArray<ReadonlyArray<RGB | null>> = [
      [BLUE, null],
      [WHITE, BLUE],
    ];
    fb.blit(1, 1, sprite);

    const px = fb.getPixels();
    expect(px[1]![1]).toEqual(BLUE); // sprite (0,0)
    expect(px[1]![2]).toEqual(GREEN); // sprite (1,0) was transparent — keep green
    expect(px[2]![1]).toEqual(WHITE); // sprite (0,1)
    expect(px[2]![2]).toEqual(BLUE); // sprite (1,1)
    // Untouched cells remain red.
    expect(px[0]![0]).toEqual(RED);
    expect(px[3]![3]).toEqual(RED);
  });

  it('fillRect clips to bounds', () => {
    const fb = new Framebuffer(4, 4);
    const C: RGB = [10, 20, 30];
    fb.fillRect(-1, -1, 3, 3, C);
    const px = fb.getPixels();
    expect(px[0]![0]).toEqual(C);
    expect(px[0]![1]).toEqual(C);
    expect(px[1]![1]).toEqual(C);
    expect(px[2]![2]).toEqual([0, 0, 0]);
  });

  it('Renderer constructs at 120x80 without throwing', () => {
    expect(() => new Renderer(120, 80)).not.toThrow();
  });
});
