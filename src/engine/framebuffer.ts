export type RGB = readonly [number, number, number];

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  private pixels: RGB[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Array(height);
    for (let y = 0; y < height; y++) {
      const row: RGB[] = new Array(width);
      for (let x = 0; x < width; x++) {
        row[x] = [0, 0, 0];
      }
      this.pixels[y] = row;
    }
  }

  setPixel(x: number, y: number, color: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels[y]![x] = color;
  }

  fill(color: RGB): void {
    for (let y = 0; y < this.height; y++) {
      const row = this.pixels[y]!;
      for (let x = 0; x < this.width; x++) {
        row[x] = color;
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let py = y0; py < y1; py++) {
      const row = this.pixels[py]!;
      for (let px = x0; px < x1; px++) {
        row[px] = color;
      }
    }
  }

  blit(
    x: number,
    y: number,
    pixels: ReadonlyArray<ReadonlyArray<RGB | null>>,
  ): void {
    for (let sy = 0; sy < pixels.length; sy++) {
      const srcRow = pixels[sy]!;
      const dy = y + sy;
      if (dy < 0 || dy >= this.height) continue;
      const dstRow = this.pixels[dy]!;
      for (let sx = 0; sx < srcRow.length; sx++) {
        const px = srcRow[sx];
        if (px === null || px === undefined) continue;
        const dx = x + sx;
        if (dx < 0 || dx >= this.width) continue;
        dstRow[dx] = px;
      }
    }
  }

  getPixels(): RGB[][] {
    return this.pixels;
  }
}
