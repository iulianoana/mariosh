import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Palette, RGB } from './palette.js';
import { _splitHeaderBody } from './palette.js';

const PixelTuple = z.tuple([z.number(), z.number(), z.number()]);

export const SpriteSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  palette: z.string().min(1),
  pixels: z.array(z.array(z.union([PixelTuple, z.null()]))),
});
export type Sprite = z.infer<typeof SpriteSchema>;

const SIZE_RE = /^(\d+)\s*x\s*(\d+)$/;

/** Parse a .sprite file source given a map of palette name -> Palette. */
export function parseSprite(
  source: string,
  palettes: Map<string, Palette>,
  filePath?: string
): Sprite {
  const provisionalLabel = filePath
    ? `sprite ${filePath}`
    : 'sprite <inline>';
  const { fields, bodyLines } = _splitHeaderBody(source, provisionalLabel);

  const name = fields['name'];
  if (!name) {
    throw new Error(`${provisionalLabel}: missing required header 'name'`);
  }
  const label = `sprite ${name}`;

  const sizeStr = fields['size'];
  if (!sizeStr) {
    throw new Error(`${label}: missing required header 'size'`);
  }
  const sizeMatch = SIZE_RE.exec(sizeStr);
  if (!sizeMatch) {
    throw new Error(
      `${label}: invalid size '${sizeStr}', expected 'WxH' (e.g. '16x16')`
    );
  }
  const width = parseInt(sizeMatch[1], 10);
  const height = parseInt(sizeMatch[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(
      `${label}: invalid size '${sizeStr}', width and height must be positive integers`
    );
  }

  const paletteName = fields['palette'];
  if (!paletteName) {
    throw new Error(`${label}: missing required header 'palette'`);
  }
  const palette = palettes.get(paletteName);
  if (!palette) {
    throw new Error(
      `${label}: declared palette '${paletteName}' not found`
    );
  }

  if (bodyLines.length < height) {
    throw new Error(
      `${label}: expected ${height} body rows, got ${bodyLines.length}`
    );
  }
  if (bodyLines.length > height) {
    const extra = bodyLines[height];
    throw new Error(
      `${label}: line ${extra.lineNo}: extra body row beyond declared height ${height}`
    );
  }

  const pixels: (RGB | null)[][] = [];
  for (let r = 0; r < height; r++) {
    const { text, lineNo } = bodyLines[r];
    if (text.length !== width) {
      throw new Error(
        `${label}: line ${lineNo}: row width ${text.length} doesn't match declared size ${width}x${height}`
      );
    }
    const row: (RGB | null)[] = [];
    for (let c = 0; c < width; c++) {
      const ch = text[c];
      if (ch === '.') {
        row.push(null);
        continue;
      }
      const color = palette.colors[ch];
      if (!color) {
        throw new Error(
          `${label}: line ${lineNo}: char '${ch}' not in palette '${paletteName}'`
        );
      }
      row.push([color[0], color[1], color[2]] as const);
    }
    pixels.push(row);
  }

  const candidate = { name, width, height, palette: paletteName, pixels };
  const result = SpriteSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `${label}: schema validation failed: ${result.error.message}`
    );
  }
  return result.data;
}

/** Load a single .sprite file from disk. */
export async function loadSprite(
  filePath: string,
  palettes: Map<string, Palette>
): Promise<Sprite> {
  const source = await readFile(filePath, 'utf8');
  try {
    return parseSprite(source, palettes, filePath);
  } catch (err) {
    if (err instanceof Error && !err.message.includes(filePath)) {
      throw new Error(`${filePath}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Load all .sprite files in a directory (non-recursive).
 * Returns Map<name, Sprite>.
 * Auto-derives sprite name from filename if header `name:` matches; conflict throws.
 */
export async function loadSpriteDir(
  dirPath: string,
  palettes: Map<string, Palette>
): Promise<Map<string, Sprite>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const map = new Map<string, Sprite>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.sprite')) continue;
    const full = path.join(dirPath, entry.name);
    const sprite = await loadSprite(full, palettes);
    const fileBase = entry.name.slice(0, -'.sprite'.length);
    if (fileBase !== sprite.name) {
      throw new Error(
        `sprite name conflict: file '${entry.name}' declares name '${sprite.name}', expected '${fileBase}'`
      );
    }
    if (map.has(sprite.name)) {
      throw new Error(
        `sprite name conflict: '${sprite.name}' defined in multiple files (last seen: ${full})`
      );
    }
    map.set(sprite.name, sprite);
  }
  return map;
}
