import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET_FPS = 60;

// Viewport in terminal cells. With half-block rendering, pixel height = rows * 2.
export const VIEWPORT_COLS = 120; // pixel width = 120
export const VIEWPORT_ROWS = 40; // pixel height = 80

export const TILE_SIZE = 16; // pixels per tile

export const SAVE_DIR = path.join(os.homedir(), '.mariosh');
export const SAVE_FILE = path.join(SAVE_DIR, 'save.json');

// ESM-safe path to src/assets at runtime.
// __filename equivalent for this module, then resolve sibling assets dir.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ASSETS_DIR = path.resolve(__dirname, 'assets');
