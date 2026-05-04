import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export type RGB = readonly [number, number, number];

const RGBTuple = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);

export const PaletteSchema = z.object({
  name: z.string().min(1),
  colors: z.record(z.string().length(1), RGBTuple),
});
export type Palette = z.infer<typeof PaletteSchema>;

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

interface SplitResult {
  fields: Record<string, string>;
  bodyLines: { text: string; lineNo: number }[];
}

/**
 * Strips an inline `#` comment from a line. A `#` is treated as the start of
 * an inline comment when preceded by whitespace, except when the `#` is the
 * start of a hex color literal (`#` followed by 3 or 6 hex digits terminated
 * by whitespace or end-of-line). This lets a body line like
 *   `R: #D82800   # mario red`
 * keep the hex literal and drop the trailing comment. Trailing whitespace on
 * the surviving prefix is removed. A `#` at column 0 is left alone — the
 * caller recognizes whole-line comments separately.
 */
function stripInlineComment(line: string): string {
  for (let i = 1; i < line.length; i++) {
    if (line[i] !== '#') continue;
    if (!/\s/.test(line[i - 1])) continue;
    // Look ahead: is this the start of a hex color literal?
    const rest = line.slice(i + 1);
    const hexMatch = /^([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?=\s|$)/.exec(rest);
    if (hexMatch) {
      // Skip past the hex literal and continue scanning for a real comment.
      i += hexMatch[0].length;
      continue;
    }
    return line.slice(0, i).replace(/\s+$/, '');
  }
  return line;
}

/**
 * Splits source into a header section and a body section delimited by `---`.
 * Strips comments (lines starting with `#` at column 0) and blank lines from
 * the header. Tracks 1-based line numbers for error messages.
 *
 * For the body: comments and blank lines are also stripped — palette/sprite
 * bodies do not need leading whitespace preserved beyond row content (sprite
 * row content cannot start with `#` since `#` is not a valid palette key here
 * unless intentionally chosen, but we treat column-0 `#` as comment per spec).
 *
 * Both header and body lines additionally have inline `# comment` suffixes
 * stripped (a `#` preceded by whitespace begins an inline comment).
 */
function splitHeaderBody(source: string, label: string): SplitResult {
  const rawLines = source.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let i = 0;
  let foundDelimiter = false;
  for (; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    if (rawLine.startsWith('#')) continue;
    const line = stripInlineComment(rawLine);
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed === '---') {
      foundDelimiter = true;
      i++;
      break;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `${label}: line ${i + 1}: expected 'key: value' or '---', got '${trimmed}'`
      );
    }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) {
      throw new Error(
        `${label}: line ${i + 1}: empty header key in '${trimmed}'`
      );
    }
    fields[key] = value;
  }
  if (!foundDelimiter) {
    throw new Error(`${label}: missing '---' header/body delimiter`);
  }
  const bodyLines: { text: string; lineNo: number }[] = [];
  for (; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const lineNo = i + 1;
    if (rawLine.startsWith('#')) continue;
    const line = stripInlineComment(rawLine);
    if (line.trim() === '') continue;
    bodyLines.push({ text: line, lineNo });
  }
  return { fields, bodyLines };
}

/** Internal: same splitter, exported for the loader. */
export function _splitHeaderBody(source: string, label: string): SplitResult {
  return splitHeaderBody(source, label);
}

/** Parse a .palette file body. Throws on invalid input with a helpful message. */
export function parsePalette(source: string, filePath?: string): Palette {
  const provisionalLabel = filePath
    ? `palette ${filePath}`
    : 'palette <inline>';
  const { fields, bodyLines } = splitHeaderBody(source, provisionalLabel);

  const name = fields['name'];
  if (!name) {
    throw new Error(`${provisionalLabel}: missing required header 'name'`);
  }
  const label = `palette ${name}`;

  const colors: Record<string, [number, number, number]> = {};
  for (const { text, lineNo } of bodyLines) {
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `${label}: line ${lineNo}: expected 'CHAR: #RRGGBB', got '${text.trim()}'`
      );
    }
    const keyPart = text.slice(0, colonIdx);
    const valuePart = text.slice(colonIdx + 1).trim();
    const key = keyPart.replace(/^\s+|\s+$/g, '');
    if (key.length !== 1) {
      throw new Error(
        `${label}: line ${lineNo}: palette key must be a single character, got '${keyPart}'`
      );
    }
    const code = key.charCodeAt(0);
    if (code > 127) {
      throw new Error(
        `${label}: line ${lineNo}: palette key must be ASCII, got '${key}'`
      );
    }
    if (key === '.') {
      throw new Error(
        `${label}: line ${lineNo}: '.' is reserved for transparent and cannot be a palette key`
      );
    }
    if (Object.prototype.hasOwnProperty.call(colors, key)) {
      throw new Error(
        `${label}: line ${lineNo}: duplicate palette key '${key}'`
      );
    }
    const rgb = parseHex(valuePart);
    if (!rgb) {
      throw new Error(
        `${label}: line ${lineNo}: expected 'CHAR: #RRGGBB', got '${text.trim()}'`
      );
    }
    colors[key] = rgb;
  }

  const candidate = { name, colors };
  const result = PaletteSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `${label}: schema validation failed: ${result.error.message}`
    );
  }
  return result.data;
}

/** Load a .palette file from disk. */
export async function loadPalette(filePath: string): Promise<Palette> {
  const source = await readFile(filePath, 'utf8');
  try {
    return parsePalette(source, filePath);
  } catch (err) {
    if (err instanceof Error && !err.message.includes(filePath)) {
      throw new Error(`${filePath}: ${err.message}`);
    }
    throw err;
  }
}

/** Load all .palette files from a directory; returns Map<name, Palette>. */
export async function loadPaletteDir(
  dirPath: string
): Promise<Map<string, Palette>> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const map = new Map<string, Palette>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.palette')) continue;
    const full = path.join(dirPath, entry.name);
    const palette = await loadPalette(full);
    if (map.has(palette.name)) {
      throw new Error(
        `palette name conflict: '${palette.name}' defined in multiple files (last seen: ${full})`
      );
    }
    map.set(palette.name, palette);
  }
  return map;
}
