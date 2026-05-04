/**
 * Phase 1 demo: composes a small static pixel scene with the framebuffer +
 * renderer + asset loaders, displays it once, and waits for any keypress.
 *
 * Run via: `npm run demo`
 *
 * Requires a truecolor (24-bit) terminal. We refuse to fall back silently to
 * 256-color because the palette has been tuned for full RGB.
 */

import path from 'node:path';
import process from 'node:process';

import { Framebuffer } from '../src/engine/framebuffer.js';
import { Renderer } from '../src/engine/renderer.js';
import { loadPaletteDir } from '../src/sprites/palette.js';
import { loadSpriteDir } from '../src/sprites/loader.js';
import type { Sprite } from '../src/sprites/loader.js';
import type { RGB } from '../src/engine/framebuffer.js';

// ---------- terminal lifecycle ----------

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

let restored = false;
let setupDone = false;

function setupTerminal(): void {
  if (setupDone) return;
  setupDone = true;
  process.stdout.write(ENTER_ALT_SCREEN);
  process.stdout.write(HIDE_CURSOR);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
}

function restoreTerminal(): void {
  if (restored) return;
  restored = true;
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // ignore — stream may already be closed
  }
  try {
    process.stdin.pause();
  } catch {
    // ignore
  }
  // Always emit the visual restore even if stdin is not a TTY, so the
  // terminal returns to a usable state when the script was run interactively.
  process.stdout.write(SHOW_CURSOR);
  process.stdout.write(LEAVE_ALT_SCREEN);
}

function installRestoreHooks(): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    restoreTerminal();
    // Re-emit default signal behavior: exit with the conventional code.
    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 129);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);
  process.on('exit', () => {
    restoreTerminal();
  });
  process.on('uncaughtException', (err) => {
    restoreTerminal();
    process.stderr.write(`uncaughtException: ${String(err)}\n`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    restoreTerminal();
    process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
    process.exit(1);
  });
}

// ---------- truecolor detection ----------

function requireTruecolor(): void {
  const colorterm = process.env.COLORTERM ?? '';
  if (colorterm === 'truecolor' || colorterm === '24bit') return;
  process.stderr.write(
    'mariosh demo requires a truecolor (24-bit) terminal.\n' +
      "  Detected COLORTERM='" +
      colorterm +
      "'. Expected 'truecolor' or '24bit'.\n" +
      '  Most modern terminals (iTerm2, Alacritty, Kitty, WezTerm, modern\n' +
      '  GNOME Terminal, Windows Terminal) support truecolor; you may need to\n' +
      '  set it in your shell:\n' +
      '    export COLORTERM=truecolor\n' +
      '  then re-run `npm run demo`.\n'
  );
  process.exit(1);
}

// ---------- scene composition ----------

interface CanvasSize {
  readonly cols: number; // pixel columns == terminal columns
  readonly pixelRows: number; // pixel rows (terminal rows * 2)
}

function pickCanvasSize(): CanvasSize {
  const targetCols = 240;
  const targetPixelRows = 120;
  const termCols = process.stdout.columns ?? targetCols;
  const termRows = process.stdout.rows ?? 60;
  // Reserve at least 2 rows: one for the help line, one for safety.
  const usableTermRows = Math.max(2, termRows - 2);
  const cols = Math.max(16, Math.min(targetCols, termCols));
  // Renderer renders 2 pixels per terminal row (half-blocks), so available
  // pixel-rows is usable terminal rows * 2. Round to even.
  const maxPixelRows = usableTermRows * 2;
  const pixelRows = Math.max(16, Math.min(targetPixelRows, maxPixelRows));
  // Ensure pixelRows is even so half-block pairs line up.
  const evenPixelRows = pixelRows - (pixelRows % 2);
  return { cols, pixelRows: evenPixelRows };
}

function composeScene(
  fb: Framebuffer,
  sky: RGB,
  sprites: Map<string, Sprite>
): void {
  fb.fill(sky);

  const ground = required(sprites, 'ground');
  const mario = required(sprites, 'mario_idle');
  const goomba = required(sprites, 'goomba_walk_1');
  const coin = required(sprites, 'coin_1');
  const brick = required(sprites, 'brick');

  // Ground strip: bottom 16 pixel rows tiled horizontally.
  const groundTopY = fb.height - ground.height;
  for (let x = 0; x < fb.width; x += ground.width) {
    fb.blit(x, groundTopY, ground.pixels);
  }

  // Mario stands on ground at x=32. Bottom-aligned to ground top.
  fb.blit(32, groundTopY - mario.height, mario.pixels);

  // Goomba further right.
  fb.blit(96, groundTopY - goomba.height, goomba.pixels);

  // Coin floating above ground.
  fb.blit(160, groundTopY - 32, coin.pixels);

  // Brick floating slightly higher.
  fb.blit(192, groundTopY - 40, brick.pixels);
}

function required<T>(map: Map<string, T>, key: string): T {
  const v = map.get(key);
  if (!v) throw new Error(`asset '${key}' not loaded`);
  return v;
}

// ---------- input ----------

function waitForKeypress(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', finish);
      resolve();
    };
    const onData = (chunk: Buffer): void => {
      // Treat Ctrl+C as a clean exit — the SIGINT handler also runs, but if the
      // raw-mode stream delivers ETX before the signal, just resolve.
      if (chunk.length > 0) finish();
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', finish);
  });
}

// ---------- main ----------

async function main(): Promise<void> {
  requireTruecolor();
  installRestoreHooks();

  const root = process.cwd();
  const palettesDir = path.resolve(root, 'src/assets/palettes');
  const spritesDir = path.resolve(root, 'src/assets/sprites');

  const palettes = await loadPaletteDir(palettesDir);
  const sprites = await loadSpriteDir(spritesDir, palettes);

  const nes = palettes.get('nes');
  if (!nes) throw new Error("palette 'nes' not loaded");
  const skyColor = nes.colors['C'];
  if (!skyColor) throw new Error("palette 'nes' missing 'C' (sky) color");
  const sky: RGB = [skyColor[0], skyColor[1], skyColor[2]] as const;

  const { cols, pixelRows } = pickCanvasSize();
  const fb = new Framebuffer(cols, pixelRows);
  composeScene(fb, sky, sprites);

  // Now that we know we're going to draw, set up the terminal.
  setupTerminal();

  const renderer = new Renderer(cols, pixelRows);
  renderer.clear();
  renderer.draw(fb);

  // Help text just below the canvas.
  const termRowsUsed = Math.floor(pixelRows / 2);
  const helpRow = termRowsUsed + 1;
  process.stdout.write(`\x1b[${helpRow};1Hpress any key to exit`);
  // Park the cursor somewhere harmless (it's hidden anyway, but be tidy).
  process.stdout.write(`\x1b[${helpRow};${'press any key to exit'.length + 1}H`);

  await waitForKeypress();

  restoreTerminal();
  process.exit(0);
}

main().catch((err) => {
  restoreTerminal();
  process.stderr.write(`demo failed: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
});
