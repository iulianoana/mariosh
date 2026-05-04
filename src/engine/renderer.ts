import chalk from 'chalk';
import { Framebuffer } from './framebuffer.js';

export class Renderer {
  private readonly cols: number;
  private readonly pixelRows: number;
  private readonly termRows: number;
  private prev: (string | undefined)[][];

  constructor(cols: number, pixelRows: number) {
    this.cols = cols;
    this.pixelRows = pixelRows;
    this.termRows = Math.floor(pixelRows / 2);
    this.prev = new Array(this.termRows);
    for (let ty = 0; ty < this.termRows; ty++) {
      this.prev[ty] = new Array(cols);
    }
  }

  draw(fb: Framebuffer): void {
    const pixels = fb.getPixels();
    let frame = '';
    for (let ty = 0; ty < this.termRows; ty++) {
      const topRow = pixels[ty * 2];
      const botRow = pixels[ty * 2 + 1];
      const prevRow = this.prev[ty]!;
      for (let x = 0; x < this.cols; x++) {
        const top = topRow?.[x] ?? ([0, 0, 0] as const);
        const bot = botRow?.[x] ?? ([0, 0, 0] as const);
        const cell = chalk
          .rgb(top[0], top[1], top[2])
          .bgRgb(bot[0], bot[1], bot[2])('▀');
        if (prevRow[x] !== cell) {
          frame += `\x1b[${ty + 1};${x + 1}H${cell}`;
          prevRow[x] = cell;
        }
      }
    }
    if (frame) process.stdout.write(frame);
  }

  clear(): void {
    for (let ty = 0; ty < this.termRows; ty++) {
      const row = this.prev[ty]!;
      for (let x = 0; x < this.cols; x++) {
        row[x] = undefined;
      }
    }
    process.stdout.write('\x1b[2J\x1b[H');
  }

  invalidate(): void {
    for (let ty = 0; ty < this.termRows; ty++) {
      const row = this.prev[ty]!;
      for (let x = 0; x < this.cols; x++) {
        row[x] = undefined;
      }
    }
  }
}
