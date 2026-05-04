# Mariosh — Terminal Mario PRD

**For:** Claude Code (master agent) running an autonomous build session with sub-agents
**Owner:** Iulian
**Mode:** Low-management. The user (Iulian) will only test at three explicitly marked checkpoints. Between checkpoints, the master agent must work autonomously and never block on questions unless something is genuinely ambiguous.

-----

## 0. How To Read This PRD (Master Agent — Read First)

You are the master agent. Your job:

1. Read this entire PRD top to bottom **before doing anything**.
1. Plan the full execution. Spawn sub-agents using the Task tool for each phase as described.
1. Build phase by phase, in order. Do not skip ahead.
1. Commit to git at the end of every phase with a meaningful message.
1. **Stop hard at every line that begins with `🛑 USER CHECKPOINT`.** Print the exact test instructions block to the user, then wait. Do not continue until the user replies “continue”, “next”, “go”, or similar.
1. If a sub-agent returns work that fails its acceptance criteria, fix it before moving on. Don’t paper over bugs.
1. Don’t ask the user clarifying questions during a phase. Make the best engineering decision and document it in a `DECISIONS.md` file at the repo root.
1. Don’t add features not in this PRD. Don’t refactor “for fun”. Don’t bikeshed.
1. Use TodoWrite to track phase-level progress so the user can see where you are.

**Sub-agent usage:** Each phase below specifies sub-agents to spawn. Run them in parallel where dependencies allow. Each sub-agent gets a focused brief — give it only the sections of this PRD it needs, plus the relevant acceptance criteria.

**Tone with the user at checkpoints:** Be concrete. Tell them the exact command to run, what they should see, what to look for that’s broken vs. fine, and what to type back to continue.

-----

## 1. Product Summary

**Mariosh** is a Mario-style 2D side-scrolling platformer that runs entirely in the terminal using half-block Unicode characters with 24-bit RGB color, producing real pixel-art graphics (not ASCII). Distributed as an npm package, installable globally without admin rights via `npm i -g mariosh` or runnable via `npx mariosh`. Target shell: PowerShell 7 in Windows Terminal, but must also work on macOS Terminal/iTerm2 and Linux terminals supporting truecolor.

**Why it exists:** Iulian wants something fun to play in 1–3 minute bursts in his terminal while waiting for Claude Code to finish tasks. Pausable, pretty, varied, with persistent progression.

**What it is not:**

- Not ASCII art (no `@`, `#`, `M` for sprites — actual pixel rendering via half-blocks)
- Not an LLM-integrated app (no API calls at runtime — sprites and levels are static text files Iulian generates externally with ChatGPT and pastes in)
- Not a clone with copyrighted assets (sprites are original, in NES-inspired style)

-----

## 2. Goals & Non-Goals

### Goals

- Smooth gameplay at 30+ fps (target 60) in Windows Terminal
- Real pixel art via Unicode half-blocks (`▀`) + truecolor
- ~3 minute levels, easily generated via text DSL
- High scores, save system, multiple level packs
- Variety: themes, animations, modifiers, daily seed
- Zero-admin install (`npm i -g` user-scope, or `npx`)
- All assets (sprites, levels) are plain text files, LLM-generatable externally

### Non-Goals (do not build)

- LLM integration / API calls at runtime
- Multiplayer / network features
- Audio (terminal beeps optional, low priority — skip for v1)
- Mobile / web port
- Level editor UI (text files are the editor)

-----

## 3. Tech Stack (Locked — Do Not Substitute)

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js ≥ 18
- **Menus / non-game UI:** Ink (React for CLIs) + ink-select-input + ink-text-input
- **Game render loop:** Pure Node, raw stdout writes, no React (Ink is too slow for 60fps frame loops)
- **Color:** `chalk` v5+ for truecolor formatting (or write ANSI escapes directly — pick one and be consistent)
- **Cursor / screen control:** `ansi-escapes`
- **Input:** Node’s raw `process.stdin` in raw mode + keypress decoding
- **Validation:** `zod` for sprite + level schema validation
- **Persistence:** Plain JSON file at `~/.mariosh/save.json` via `fs/promises` (no `conf` lib needed)
- **Build:** `tsc` to `dist/`. No bundler.
- **Test:** `vitest` for unit tests on parsers, physics math, palette logic. No tests for the render loop (manual checkpoint testing covers that).
- **Package manager:** npm (Iulian’s environment)

**Forbidden:**

- `terminal-kit` (heavyweight, conflicts with Ink)
- `blessed` / `blessed-contrib` (not pixel-capable in the way we need)
- Any native node modules / `node-gyp` deps (must install without build tools)
- Bundlers (esbuild, rollup, webpack) — overkill for this
- CommonJS — ESM only

-----

## 4. Architecture

```
                    ┌──────────────────────────┐
                    │        bin/mariosh.js    │
                    │   (#!/usr/bin/env node)  │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │       src/cli.tsx        │
                    │  (entry, arg parse)      │
                    └────────────┬─────────────┘
                                 │
            ┌────────────────────┴─────────────────────┐
            │                                          │
   ┌────────▼─────────┐                    ┌───────────▼──────────┐
   │   Ink Menu Tree  │                    │    Game Runner       │
   │  (title, level   │   ── starts ──>    │  (raw mode, render   │
   │   select, scores,│                    │   loop, takes over   │
   │   settings)      │   <── exits to ──  │   stdout entirely)   │
   └──────────────────┘                    └───────────┬──────────┘
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              │                        │                        │
                     ┌────────▼────────┐     ┌─────────▼────────┐     ┌────────▼────────┐
                     │  Renderer       │     │   Physics +      │     │   Level         │
                     │  (framebuffer,  │     │   Entities       │     │   Loader        │
                     │   half-block,   │     │   (Mario,        │     │   (parses .lvl) │
                     │   diffing)      │     │    enemies, etc.)│     │                 │
                     └─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Critical rule:** Ink and the game loop **must not run simultaneously**. The Ink tree fully unmounts before the game takes over stdout, and the game fully exits (resets terminal) before Ink remounts. Use `app.unmount()` from Ink and a `gameRunner.start(level): Promise<GameResult>` API.

-----

## 5. Half-Block Rendering Spec

A terminal cell is taller than wide (~2:1 ratio). Using the Unicode upper-half-block character `▀`:

- **Foreground color** = top pixel
- **Background color** = bottom pixel

This gives 2 pixels per terminal cell, each in 24-bit RGB. A 120×40 terminal becomes a 120×80 pixel canvas.

### Reference renderer (this exact pattern)

```ts
// src/engine/renderer.ts
import chalk from 'chalk';

export class Renderer {
  private prev: string[][] = [];      // last frame's cell strings
  private out: string[] = [];         // build buffer per frame

  constructor(private cols: number, private rows: number) {
    // rows is in pixels; terminal rows = rows / 2
  }

  /**
   * fb[y][x] = [r, g, b]. y goes top to bottom in pixel space.
   * Length: rows pixels tall, cols pixels wide.
   */
  draw(fb: [number, number, number][][]): void {
    const termRows = Math.floor(this.rows / 2);
    let frame = '';
    for (let ty = 0; ty < termRows; ty++) {
      let runChanged = false;
      let lineParts: string[] = [];
      for (let x = 0; x < this.cols; x++) {
        const top = fb[ty * 2]?.[x] ?? [0, 0, 0];
        const bot = fb[ty * 2 + 1]?.[x] ?? [0, 0, 0];
        const cell = chalk.rgb(...top).bgRgb(...bot)('▀');
        if (this.prev[ty]?.[x] !== cell) {
          // dirty cell — emit cursor move + cell
          frame += `\x1b[${ty + 1};${x + 1}H${cell}`;
          if (!this.prev[ty]) this.prev[ty] = [];
          this.prev[ty][x] = cell;
        }
      }
    }
    if (frame) process.stdout.write(frame);
  }

  clear(): void {
    this.prev = [];
    process.stdout.write('\x1b[2J\x1b[H');
  }
}
```

**Performance requirements:**

- One `process.stdout.write` per frame (batch all changes into a single string)
- Dirty-cell diffing — never redraw unchanged cells
- Target: render a 120×80 framebuffer at 60fps with <8ms per frame on Iulian’s machine

-----

## 6. Sprite Format Spec

Sprites are plain text files in `src/assets/sprites/*.sprite`. One sprite per file. Format:

```
# Header (key: value lines)
name: mario_idle
size: 16x16
palette: nes
---
# Body: one char per pixel, '.' = transparent
....RRRRRRR.....
...RRRRRRRRRR...
...BBBSSKSS.....
..BSBSSSKSSS....
..BSBBSSSKSSS...
..BBSSSSKKKK....
....SSSSSSS.....
...RRLRRLRR.....
..RRRRLRLRRRR...
.RRRRLLLLRRRR...
.SSRLLYLLYLRSSS.
.SSSLLLLLLLLSSS.
.SSLLLLLLLLLLSS.
...LLLL..LLLL...
..BBBB....BBBB..
..BBBB....BBBB..
```

Palettes live in `src/assets/palettes/*.palette`:

```
name: nes
---
R: #D82800   # mario red
S: #FCBC8C   # skin
B: #884C1C   # brown
L: #3C5CF8   # blue overalls
Y: #FCDC3C   # gold
K: #000000   # black
W: #FCFCFC   # white
G: #00A800   # grass
O: #E45C10   # brick orange
C: #5C94FC   # sky
```

**Sprite loader:** `src/sprites/loader.ts` parses `.sprite` files, validates with zod, returns:

```ts
type Sprite = {
  name: string;
  width: number;
  height: number;
  pixels: ([number, number, number] | null)[][]; // null = transparent
};
```

**Animation chains:** by filename convention. `goomba_walk_1.sprite`, `goomba_walk_2.sprite` are auto-grouped into an animation by stripping the `_1`/`_2` suffix. Frame timing defined in `src/entities/<name>.ts`.

**Required initial sprite set (Phase 4 sub-agent must produce these):**

- `mario_idle`, `mario_walk_1`, `mario_walk_2`, `mario_walk_3`, `mario_jump`, `mario_crouch`, `mario_dead`
- `mario_super_*` (same set, larger)
- `mario_fire_*` (same set, fire palette)
- `goomba_walk_1`, `goomba_walk_2`, `goomba_squashed`
- `koopa_walk_1`, `koopa_walk_2`, `koopa_shell`
- `piranha_1`, `piranha_2`
- `coin_1`, `coin_2`, `coin_3`, `coin_4` (spin animation)
- `mushroom`, `flower_1`, `flower_2`, `star_1`, `star_2`
- `brick`, `qblock_1`, `qblock_2`, `qblock_used`
- `ground`, `pipe_top_left`, `pipe_top_right`, `pipe_body_left`, `pipe_body_right`
- `cloud_small`, `cloud_large`, `bush`, `hill`
- `flag_pole`, `flag`, `castle`

If sprite art quality is below acceptable, the sprites sub-agent should produce a starter set good enough for gameplay testing — Iulian will refine in ChatGPT and replace `.sprite` files later. **Do not block phases on sprite art polish.**

-----

## 7. Level Format Spec

Levels are plain text files in `src/assets/levels/<theme>/*.level`. Format:

```
name: World 1-1
theme: overworld
length: 192
time: 300
music: overworld    # optional, ignored in v1
---
................................................................................................................................................................................
................................................................................................................................................................................
................................................................................................................................................................................
................................................................................................................................................................................
................................................................................................................................................................................
................................................................................................................................................................................
.................?.B?B................c.c.c....................................................................BBBBBBB....BBBBB.................................................
................................................................................................................................................................................
................................................c.....................c.c.c...........................BBBB....................BBBB..............................................
............................................................c..c......................................BBBB....................BBBB..............................................
.....g....k.........................gg........g........g.......pp.....g....g..g....k........................................................................G..................F
GGGGGGGGGGGGGGGGGGGGGG__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGppGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
GGGGGGGGGGGGGGGGGGGGGG__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGppGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG
```

### Tile legend (locked)

- `.` empty / sky
- `G` ground (solid, top has grass)
- `g` goomba spawn
- `k` koopa (red shell) spawn
- `K` koopa (green, walks off ledges) spawn
- `f` flying koopa (paratroopa) spawn
- `B` brick (breakable when super)
- `?` mystery block (contains coin by default)
- `M` mystery block (contains mushroom)
- `F` mystery block (contains fire flower)
- `*` mystery block (contains star)
- `c` coin
- `p` pipe (solid, vertical pair `pp` per row)
- `P` pipe entrance (warps; pipe destination defined in header)
- `_` pit (no ground — fall = death)
- `H` hill (background decoration, non-solid)
- `b` bush (background decoration)
- `T` piranha plant (must be on top of pipe)
- `s` solid stone (unbreakable, brick-shaped)
- `=` floating platform
- `^` spike (instant damage)
- `F` flagpole (level end) — when this appears in the rightmost column area
- `C` castle (decoration, after flag)

**Pipe warp syntax in header (optional):**

```
warp_a: 0:bonus_room_1   # pipe labeled 'a' warps to level 'bonus_room_1' at spawn 0
```

And in body, replace `P` with the warp letter:

```
....aa....
....pp....
```

### Level loader

- Parse header → metadata
- Parse body → 2D tile array
- Each tile char maps to (a) static tile placement OR (b) entity spawn
- Static tiles go into a tile grid for collision; entity spawns become entity instances at level start
- Validate with zod: width consistent across rows, length matches header, all chars in legend

### Default level pack

Phase 5 sub-agent must produce **at minimum** 8 starter levels:

- `overworld/1-1.level` through `overworld/1-4.level`
- `underground/2-1.level`, `underground/2-2.level`
- `castle/3-1.level`
- `sky/4-1.level`

Each ~150–250 cols wide. Hand-designed for v1 (or LLM-generated and curated by sub-agent).

-----

## 8. File Structure (Locked)

```
mariosh/
├── bin/
│   └── mariosh.js                  # shebang entry
├── src/
│   ├── cli.tsx                     # Ink root + game runner orchestration
│   ├── config.ts                   # constants (target FPS, viewport size, paths)
│   ├── ink/
│   │   ├── App.tsx                 # router state machine (title/menu/playing/scores)
│   │   ├── TitleScreen.tsx
│   │   ├── MainMenu.tsx
│   │   ├── LevelSelect.tsx
│   │   ├── HighScores.tsx
│   │   ├── Settings.tsx
│   │   └── PauseOverlay.tsx        # rendered via game runner, not Ink (see note)
│   ├── engine/
│   │   ├── framebuffer.ts          # RGB pixel buffer
│   │   ├── renderer.ts             # half-block writer with diffing
│   │   ├── loop.ts                 # fixed-timestep 60fps loop
│   │   ├── input.ts                # raw stdin keypress decoder
│   │   ├── camera.ts               # scrolling viewport with deadzone
│   │   └── runner.ts               # the orchestrator: runs a level, returns GameResult
│   ├── physics/
│   │   ├── aabb.ts                 # collision math
│   │   ├── movement.ts             # gravity, velocity, integration
│   │   └── tileCollision.ts        # entity-vs-tile resolution
│   ├── entities/
│   │   ├── Entity.ts               # base class
│   │   ├── Mario.ts
│   │   ├── Goomba.ts
│   │   ├── Koopa.ts
│   │   ├── PiranhaPlant.ts
│   │   ├── Coin.ts
│   │   ├── Mushroom.ts
│   │   ├── FireFlower.ts
│   │   ├── Star.ts
│   │   ├── Fireball.ts
│   │   └── Particle.ts
│   ├── tiles/
│   │   ├── tile.ts                 # Tile type + behaviors (solid, breakable, mystery)
│   │   └── tileMap.ts              # the level's tile grid, with bump/break support
│   ├── sprites/
│   │   ├── loader.ts
│   │   ├── animation.ts
│   │   └── palette.ts
│   ├── levels/
│   │   ├── parser.ts
│   │   ├── packs.ts                # scans assets/levels/, builds level index
│   │   └── schema.ts               # zod schema
│   ├── save/
│   │   └── store.ts                # ~/.mariosh/save.json
│   ├── hud/
│   │   ├── hud.ts                  # in-game HUD (score, coins, time, lives)
│   │   └── text.ts                 # bitmap font rendering for HUD
│   ├── audio/                      # leave empty in v1, scaffold only
│   │   └── README.md
│   └── assets/
│       ├── palettes/
│       │   ├── nes.palette
│       │   ├── underground.palette
│       │   ├── castle.palette
│       │   └── sky.palette
│       ├── sprites/                # ~50 .sprite files
│       └── levels/
│           ├── overworld/
│           ├── underground/
│           ├── castle/
│           └── sky/
├── prompts/
│   ├── sprite.md                   # ChatGPT prompt template for sprite gen
│   └── level.md                    # ChatGPT prompt template for level gen
├── tests/
│   └── ... unit tests for parsers + physics
├── DECISIONS.md                    # master agent logs design decisions here
├── README.md
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### `src/hud/text.ts` — bitmap font

Implement a tiny 5x7 bitmap font for HUD text (`COINS x 03`, `WORLD 1-1`, `TIME 247`, `SCORE 001200`). Don’t use terminal text (it would render at one terminal-cell resolution which clashes with pixel art). Render font glyphs as pixel patterns into the framebuffer.

A–Z, 0–9, space, `-`, `x`, `:` is enough. The sub-agent for HUD generates these glyphs.

-----

## 9. Distribution Requirements

### `package.json`

```json
{
  "name": "mariosh",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mariosh": "./bin/mariosh.js" },
  "engines": { "node": ">=18" },
  "files": ["bin", "dist", "src/assets", "README.md"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "demo": "tsx scripts/render-demo.ts",
    "start": "node bin/mariosh.js",
    "test": "vitest run"
  }
}
```

### `bin/mariosh.js`

```js
#!/usr/bin/env node
import('../dist/cli.js');
```

### Install scenarios (must all work)

- `npm i -g mariosh` then `mariosh` (global, user scope on Windows — no admin)
- `npx mariosh` (zero-install)
- `npm i mariosh` then `npx mariosh` (local)

### Terminal compatibility

- **Primary:** PowerShell 7 in Windows Terminal (Iulian’s daily driver)
- **Must also work:** macOS Terminal, iTerm2, Linux gnome-terminal
- On startup, detect truecolor support (`COLORTERM=truecolor` or `=24bit`). If absent, print a warning and exit with link to enable it. Don’t silently fall back to 256-color.

### On startup

- Save and switch to alternate screen buffer (`\x1b[?1049h`)
- Hide cursor
- Set raw mode on stdin
- On exit (clean or `Ctrl+C`): restore cursor, leave alt buffer, restore stdin mode. **This must be bulletproof** — failure leaves the user’s terminal broken. Use `process.on('exit')`, `SIGINT`, `SIGTERM`, and `uncaughtException` handlers.

-----

# PHASES

Each phase has: **Sub-agents to spawn**, **Deliverables**, **Acceptance criteria**, optionally a **🛑 USER CHECKPOINT**.

-----

## Phase 1 — Foundation + Renderer

**Goal:** Project skeleton + working half-block renderer that can paint a static Mario sprite on screen. This is the technical risk phase — if half-block rendering doesn’t look good in PowerShell 7, everything else is moot.

### Sub-agents

1. **`scaffold`** — create file structure, `package.json`, `tsconfig.json`, `vitest.config.ts`, install deps, create empty stub files per the locked structure. Set up `bin/mariosh.js` shebang entry and ESM config. Create `DECISIONS.md` and `README.md` with placeholders.
1. **`renderer`** — implement `src/engine/framebuffer.ts` and `src/engine/renderer.ts` per Section 5. Add helpers to fill regions, draw sprites onto the framebuffer, clear, etc.
1. **`sprite-loader`** — implement `src/sprites/loader.ts`, `palette.ts`, the zod schema. Parse the `.sprite` text format. Loader returns the typed `Sprite` object.
1. **`starter-art`** — produce `src/assets/palettes/nes.palette` with the colors from Section 6, and produce 5 starter sprites: `mario_idle.sprite`, `goomba_walk_1.sprite`, `coin_1.sprite`, `brick.sprite`, `ground.sprite`. These don’t need to be polished — recognizable is enough.
1. **`demo-script`** — create `scripts/render-demo.ts` that:
- Sets up alt screen + raw mode
- Loads all starter sprites
- Composes a 240×120 pixel scene: sky background, ground row at the bottom, Mario standing on ground, a goomba 20 tiles to the right, a coin floating, a brick floating
- Renders one frame
- Waits for any keypress, then cleanly restores the terminal and exits

### Deliverables

- Repo builds with `npm run build` with no errors
- `npm run demo` shows a static pretty pixel-art scene in the user’s terminal
- Unit tests for the sprite parser pass

### Acceptance criteria

- Sprite parser rejects malformed `.sprite` files with a clear error
- Renderer produces no flicker on a static scene (this is trivial since nothing changes — the test is “is the colored output legible?”)
- Terminal is restored cleanly on exit (cursor visible, alt buffer left, stdin not in raw mode) — verify by typing `echo hi` after demo exits
- Truecolor detection works — if `COLORTERM` is not set, prints a helpful message

### 🛑 USER CHECKPOINT 1 (post-Phase 1)

**Master agent must print this exact block to the user:**

> **STOP — TIME TO TEST (Checkpoint 1 of 3)**
> 
> What I built: project skeleton + half-block pixel renderer + sprite loader + starter sprites + a demo scene.
> 
> **Run this:**
> 
> ```
> cd mariosh
> npm install
> npm run demo
> ```
> 
> **What you should see:**
> 
> - A blue sky background
> - A green/brown ground strip across the bottom
> - Mario sprite (red hat, blue overalls) standing on the ground on the left
> - A goomba (brown enemy) standing on the ground further right
> - A floating coin (yellow, spinning frame visible)
> - A floating brick block (orange)
> - The scene fills your terminal width
> - Colors are vivid and look like NES pixel art, NOT washed-out or text-like
> - No flicker, no garbled characters
> 
> **Press any key to exit the demo.** After exit:
> 
> - Your terminal cursor should be visible again
> - Typing `echo hi` should work normally (terminal not stuck in raw mode)
> 
> **What to check specifically:**
> 
> 1. Does the pixel art look pretty? If sprites look broken / squished / wrong colors → tell me and I’ll fix.
> 1. Are there any visual artifacts (lines between rows, wrong chars showing)? If yes, half-block rendering is misconfigured.
> 1. Does your terminal recover cleanly after exit?
> 
> **Reply `continue` to move to Phase 2, or describe what looks wrong.**

-----

## Phase 2 — Engine Core: Loop, Input, Physics, Camera, Mario Movement

**Goal:** A playable but minimal level. Mario walks, jumps, gravity, collides with ground and bricks. Camera scrolls. No enemies yet. No power-ups. No HUD. Just movement feel.

### Sub-agents

1. **`loop-input`** — implement `src/engine/loop.ts` (fixed 60fps timestep, accumulator pattern, separate update/render rates) and `src/engine/input.ts` (raw stdin keypress decoder for arrow keys, space, shift, esc, q). Input emits a snapshot of current key state per frame, not events.
1. **`level-parser`** — implement `src/levels/parser.ts`, `src/levels/schema.ts`, `src/levels/packs.ts`. Parse the `.level` format from Section 7. Build a `TileMap` and an entity spawn list. Strip Section 7 down to only what Phase 2 needs (entity spawns can be no-ops for now), but the parser must accept the full format.
1. **`physics`** — implement `src/physics/*` and `src/tiles/*`. AABB-vs-AABB and AABB-vs-tile collision. Gravity. Velocity integration. Variable-height jump (release space cuts upward velocity). Friction on ground, less in air. Tunable constants in `src/config.ts`.
1. **`mario-entity`** — implement `src/entities/Entity.ts` (base) and `src/entities/Mario.ts`. State machine: idle/walking/running/jumping/falling. Hooks input → applies forces → integrates → resolves collisions. Uses `mario_idle` sprite for everything in Phase 2 (animations come later).
1. **`camera-runner`** — implement `src/engine/camera.ts` (horizontal scroll with a deadzone in the middle of the viewport, never scrolls past level edges) and `src/engine/runner.ts` (orchestrates: load level, spawn Mario, run loop, render each frame, return on death/exit).
1. **`starter-level`** — produce `src/assets/levels/overworld/test-1.level` — a flat ~120-col level with some pits, some floating brick platforms, a couple of `?` blocks, a flagpole at the end. No enemies. Designed to test movement and collision edge cases.

### Deliverables

- `npm run dev -- play overworld/test-1` (or similar) launches into the test level
- Mario controllable, scrolls, can jump, falls into pits → restart
- `?` blocks are solid (no coin behavior yet — that’s Phase 3)
- Touching the flagpole exits the level cleanly back to terminal

### Acceptance criteria

- Maintains 60fps on a 120-col level (time per frame logged in `--debug` mode)
- No tunneling: even at max horizontal speed, Mario can’t pass through ground or bricks
- Variable jump feels responsive (tap = small hop, hold = full jump)
- Camera doesn’t jitter; deadzone keeps Mario centered while moving
- Pressing `q` or `esc` exits cleanly back to terminal (no broken state)

**No user checkpoint here.** Master agent moves directly to Phase 3.

-----

## Phase 3 — Full Gameplay: Enemies, Power-ups, Coins, HUD, Lives

**Goal:** A complete, fun playable level. Stomp goombas. Hit `?` blocks for coins/mushrooms. Grow big. Lose power on hit. Die for real. HUD shows score/coins/time/lives. Reach flagpole = win.

### Sub-agents (run in parallel where possible)

1. **`enemies`** — implement `Goomba`, `Koopa` (with shell mechanics: stomp once → shell, kick shell → slides and kills others, can come back and kill Mario), `PiranhaPlant` (rises from pipe, retracts, won’t rise if Mario adjacent). Stomp detection (Mario falling onto enemy from above).
1. **`pickups`** — implement `Coin`, `Mushroom` (moves right, bounces off walls, falls, makes Mario super), `FireFlower` (static, makes Mario fire), `Star` (bounces, invincibility for ~10s), `Fireball` (Mario projectile when fire, bounces along ground until hits enemy or wall).
1. **`mario-states`** — extend `Mario.ts` with size states (small / super / fire), invincibility frames after taking damage, fireball shooting (B button = shift), death animation (flips up, falls off screen).
1. **`tile-behaviors`** — implement `?` block (bumps when hit from below, ejects coin/mushroom/flower/star based on tile metadata, becomes used), brick (bumps when small Mario hits, breaks into 4 chunks when super hits, gives coin if marked), pipes (Mario can enter top-facing pipes if Down pressed → warp to destination if defined, otherwise non-interactive).
1. **`hud-font`** — implement `src/hud/text.ts` 5×7 bitmap font (A–Z, 0–9, space, `-`, `x`) and `src/hud/hud.ts` — top-of-screen HUD overlaid on framebuffer: `MARIO 001200    COINS x03    WORLD 1-1    TIME 247`. Lives shown as small icons next to score in a 2nd line, or compressed.
1. **`game-state`** — implement run state (lives, score, coin count, current world-stage), level transition logic (flagpole touched → tally bonuses → next level), game over screen (overlay), level select returns to Ink menu.
1. **`real-levels`** — replace `test-1.level` with proper `overworld/1-1.level` that uses every tile type. Plus `overworld/1-2.level` for variety. ~200 cols each. Goombas, koopas, pipes, ?-blocks with mushrooms, secret coin areas, etc.
1. **`mario-ink-shell`** — minimal Ink wrapper: title screen → “Press Enter to play” → goes straight into 1-1. After death: simple “GAME OVER — Enter to retry, Q to quit”. This is a placeholder for Phase 5’s full menu, but needed so the user can actually play and replay easily at the checkpoint.

### Deliverables

- `npm run dev` (or `mariosh` if linked) shows title screen
- Press Enter → plays 1-1
- All gameplay mechanics work end-to-end
- Die or finish → game over / next level

### Acceptance criteria

- Stomping a goomba kills it; running into one (small) loses power / kills
- ?-block hit from below bumps and ejects a coin (or mushroom on the marked one); becomes used
- Brick: bumps if small, breaks if super
- Mushroom turns Mario super; super Mario takes a hit → small (with i-frames), small Mario takes a hit → dies
- Falling into pit = death regardless of size
- HUD updates in real time
- Lives decrement on death; 0 lives = game over
- Touching flagpole gives bonus based on height, transitions to next level
- 60fps maintained with multiple enemies on screen + particles

### 🛑 USER CHECKPOINT 2 (post-Phase 3)

**Master agent must print this exact block to the user:**

> **STOP — TIME TO TEST (Checkpoint 2 of 3)**
> 
> What I built: full gameplay. You can actually play Mario in your terminal now.
> 
> **Run this:**
> 
> ```
> npm run dev
> ```
> 
> **Controls:**
> 
> - `←` / `→` — move
> - `Shift` (hold) — run
> - `Space` — jump (hold for higher)
> - `Down` — crouch / enter pipe (when standing on top-facing pipe)
> - `Z` or `B` — shoot fireball (when fire Mario)
> - `Esc` — pause / menu
> - `Q` — quit to terminal
> 
> **What you should see / be able to do:**
> 
> 1. Title screen → press Enter → World 1-1 loads.
> 1. HUD at top: SCORE, COINS, WORLD, TIME, LIVES.
> 1. Walk and run right. Camera scrolls.
> 1. Hit a `?` block from below — coin pops out, score goes up.
> 1. Find a `?` block that ejects a mushroom — grab it, Mario grows.
> 1. Stomp a goomba — score goes up, goomba squashes.
> 1. Run into a goomba (when small) — Mario dies, life decrements, level restarts.
> 1. Hit a brick when super — it breaks into chunks.
> 1. Kick a koopa shell — it slides and kills other enemies.
> 1. Grab a fire flower — Mario turns red/white, can shoot fireballs with Z.
> 1. Reach the flagpole — points tally, transitions to 1-2.
> 1. Lose all lives — GAME OVER screen, Enter to retry.
> 1. Press Esc mid-game — pauses (game freezes, overlay shown), Esc again unpauses.
> 
> **What to check specifically:**
> 
> 1. **Does it feel fun?** Movement, jump weight, game speed. If Mario feels floaty / sluggish / jittery, tell me which.
> 1. **Is the framerate smooth?** Should be ~60fps. If choppy, tell me.
> 1. **Are there any obvious gameplay bugs?** (Tunneling through walls, enemies floating, coins not registering, getting stuck.)
> 1. **Does the terminal recover cleanly** after Q or Ctrl+C?
> 1. **Anything visually wrong** — sprites missing, HUD overlapping, wrong colors per theme?
> 
> **Reply `continue` to move to Phases 4–5 (polish, animations, full menu, save system, more levels), or describe what’s broken / what feels bad.**

-----

## Phase 4 — Polish & Variety (no checkpoint)

**Goal:** Make it pretty and varied. Animations, particles, themes, parallax, screen shake, more sprites.

### Sub-agents

1. **`animation-system`** — implement `src/sprites/animation.ts` — frame chains, configurable timing, looping vs one-shot. Wire Mario walk cycle, goomba waddle, coin spin, ?-block pulse, water shimmer (if used).
1. **`sprite-set-full`** — produce the full sprite set listed in Section 6. Curate quality. Iulian will replace any he doesn’t like later via the prompt template.
1. **`particles-fx`** — implement `src/entities/Particle.ts`: brick chunks (4 per broken brick, gravity + random velocity), coin sparkle, stomp dust puff, fireball trail, score-popup (`+100` rises and fades). Add to `runner.ts` particle system pool (preallocated to avoid GC).
1. **`themes-palettes`** — produce `underground.palette`, `castle.palette`, `sky.palette`. Implement palette swap at level load (theme in level header → loads matching palette → re-renders sprites with palette index lookup). Sprites are palette-indexed via the char map, so a swap only changes color, not data.
1. **`parallax-bg`** — implement background layers. Cloud layer scrolls at 0.5x camera speed. Hill layer at 0.7x. Foreground tiles at 1x. Each theme has its own background tile set.
1. **`screen-shake`** — global `Camera.shake(intensity, duration)`. Triggered on big stomps, brick breaks, taking damage, boss hits.
1. **`death-anim-fx`** — Mario death: flips up, hangs, falls off bottom. Time-up: timer flashes red last 30s, then forced death. Pit fall: sprite falls straight down past camera.

### Deliverables

- All animations playing smoothly
- Each theme palette visually distinct
- Particles and shake feel impactful

### Acceptance criteria

- Walk cycle plays at correct cadence with horizontal speed
- Particles don’t drop framerate when 50+ are on screen
- Theme switch is instant on level load
- No visual artifacts from parallax (clouds don’t flicker on scroll)

-----

## Phase 5 — Meta + Persistence (no checkpoint)

**Goal:** Title screen, full menus, save system, high scores, multiple level packs, settings, daily seed, modifiers.

### Sub-agents

1. **`ink-menus`** — full menu tree: Title → Main Menu (Play / Level Select / High Scores / Daily / Settings / Quit). Use ink-select-input for nav. Title screen has bouncing ASCII-art-but-actually-half-block “MARIOSH” logo (rendered as a sprite, not text).
1. **`save-system`** — `src/save/store.ts`. JSON file at `~/.mariosh/save.json`. Schema:
   
   ```json
   {
     "version": 1,
     "highScores": { "overworld/1-1": [{"score":12500,"coins":24,"time":89,"date":"..."}] },
     "totalCoins": 0,
     "deaths": 0,
     "completions": { "overworld/1-1": true },
     "settings": { "scale": 1, "showFps": false }
   }
   ```
   
   Atomic writes (write to `.tmp`, rename). Migration handler for `version` bumps.
1. **`level-pack-system`** — scan `src/assets/levels/*` at startup, build pack list. Level select shows packs + levels with completion stars. New level packs can be dropped in by users (post-install) at `~/.mariosh/levels/<theme>/*.level` and are auto-loaded.
1. **`high-scores`** — track per-level top 5 scores in save file. High score screen shows table. Score is points + coins*100 + (time_remaining * 10).
1. **`daily-seed`** — daily mode: deterministic level chosen by date hash. Seed shown on screen. Single attempt per day (recorded in save). Separate leaderboard section for daily streak.
1. **`modifiers`** — implement modifier system. Before a level (in Level Select with Shift+Enter), pick from: low gravity, high gravity, mirror (flipped controls or visuals), dark (only see near Mario), slippery (no friction), speedrun (no time limit, timer visible). Modifiers don’t unlock new sprites, just tweak constants. Score gains a modifier multiplier.
1. **`pause-overlay`** — proper in-game pause overlay rendered by the game runner (NOT Ink — Ink is unmounted while game runs). Translucent dark layer, “PAUSED” text, options: Resume, Restart Level, Quit to Menu. Up/Down to navigate, Enter to select.
1. **`settings`** — Settings screen: Scale (1x default, 2x for big terminals), Show FPS, Show input debug, Reset save. All persisted to save file.

### Deliverables

- Full menu navigation works
- Save file persists across runs
- High scores update after each level
- Daily seed works (changes at local midnight)
- Modifiers measurably change gameplay

### Acceptance criteria

- Save file never corrupts (atomic writes confirmed by killing the process mid-save)
- Menu navigation feels snappy
- All level packs from disk load on startup
- Settings changes apply immediately and persist
- Pause overlay doesn’t break the underlying frame state — resume continues exactly where it was

-----

## Phase 6 — Distribution + Final Polish

**Goal:** Ship-ready npm package. Real README. ChatGPT prompt templates for sprites and levels. Cross-platform install verified.

### Sub-agents

1. **`packaging`** — finalize `package.json`, `bin/mariosh.js` shebang, `files` whitelist, `.npmignore`. Build pipeline: `npm run build` → `dist/`. Assets copied to `dist/` or referenced from `src/assets/`. **Critical:** verify `npm pack` produces a tarball that, when installed elsewhere, runs correctly. Test by doing `npm pack`, then in `/tmp` doing `npm i ./mariosh-0.1.0.tgz`, then running `mariosh`.
1. **`prompt-templates`** — write `prompts/sprite.md` and `prompts/level.md`. Each is a paste-ready ChatGPT prompt. Sprite prompt: explains the format, palette legend, asks for one 16×16 sprite at a time, gives examples. Level prompt: explains the tile legend, asks for a level of given length and theme, includes 2-3 example levels in the prompt for ChatGPT to learn the style.
1. **`readme`** — proper `README.md`: install (`npm i -g mariosh` and `npx mariosh`), screenshots (use the demo command output piped through a screenshot tool, or just ASCII-art an example), controls, level/sprite extension via `~/.mariosh/levels/`, prompt template links, troubleshooting (truecolor, raw mode recovery).
1. **`startup-checks`** — first-run wizard: detect terminal capabilities, warn if truecolor missing, warn if terminal too small (< 80 cols), confirm save dir creation. One-liner banner on every startup with version + tip of the day.
1. **`cleanup-handlers`** — bulletproof signal handling. Final review: every `process.on('exit')`, `SIGINT`, `SIGTERM`, `SIGHUP`, `uncaughtException`, `unhandledRejection` correctly restores: cursor visible, alt screen left, raw mode off, stdin resumed. Test by running game, hitting Ctrl+C in middle of frame, confirming terminal works.
1. **`demo-mode`** — `mariosh --demo` runs an attract loop: title screen 5s → auto-plays a level using a recorded input script → game over → loops. For showing off / streaming.
1. **`ghost-replay`** — record best run per level (input sequence + RNG seed), replay it as a faded sprite alongside live play. Toggle in settings. Last polish item.

### Deliverables

- Tarball produced by `npm pack` installs and runs end-to-end on a fresh machine
- `npx mariosh` works
- README is a real README, not boilerplate
- Prompt templates are paste-and-go for ChatGPT

### Acceptance criteria

- All Section 9 install scenarios verified
- Terminal always recovers, no matter how the process exits
- Cold start to playable in < 2 seconds
- Bundle size sane (sprite assets compressed if total > 1MB)

### 🛑 USER CHECKPOINT 3 — FINAL (post-Phase 6)

**Master agent must print this exact block to the user:**

> **STOP — FINAL TEST (Checkpoint 3 of 3)**
> 
> What I built: the full game, ship-ready, with menus, save, scores, daily seed, modifiers, animations, particles, multiple themes, prompt templates, and a polished install path.
> 
> **Test the install path first:**
> 
> ```
> cd mariosh
> npm pack
> # Verify a tarball was produced.
> 
> # In a different directory:
> cd ~/Desktop
> npx /full/path/to/mariosh-0.1.0.tgz
> ```
> 
> Then also test:
> 
> ```
> npm i -g /full/path/to/mariosh-0.1.0.tgz
> mariosh
> ```
> 
> (No admin rights should be required on Windows — npm installs to your user prefix.)
> 
> **What to verify (full game tour):**
> 
> 1. **Title screen** — bouncing logo, menu options visible.
> 1. **Main Menu** — Play / Level Select / High Scores / Daily / Settings / Quit. All navigable with arrow keys.
> 1. **Play** — drops you into 1-1.
> 1. **Level Select** — shows all level packs, completion stars, lets you pick any unlocked level.
> 1. **Modifiers** — Shift+Enter on a level → pick a modifier → game applies it.
> 1. **High Scores** — shows top scores per level, your records.
> 1. **Daily** — shows today’s seed, lets you play one attempt.
> 1. **Settings** — toggle FPS counter, change scale, reset save.
> 1. **Animations** — Mario walk cycle, coin spin, ?-block pulse, goomba waddle. All smooth.
> 1. **Particles** — break a brick (when super), see chunks fly. Stomp goomba, see dust puff. Hit ?-block, see coin sparkle.
> 1. **Themes** — play a level from each pack (overworld/underground/castle/sky), confirm visual difference.
> 1. **Pause** — Esc mid-game freezes everything cleanly. Resume / Restart / Quit options work.
> 1. **Save** — finish a level, quit completely, relaunch — high score is still there.
> 1. **Death recovery** — Ctrl+C mid-game, terminal recovers fully.
> 1. **Demo mode** — `mariosh --demo` runs the attract loop.
> 1. **Prompt templates** — open `prompts/sprite.md` and `prompts/level.md` — they should be paste-ready into ChatGPT.
> 1. **Add a custom level** — drop a `.level` file into `~/.mariosh/levels/overworld/` and confirm it shows up in Level Select.
> 
> **What to check specifically:**
> 
> 1. **Polish** — does it feel like a real, finished thing? Or rough?
> 1. **Performance** — 60fps in all themes, with particles, with shake?
> 1. **Install** — fresh install scenario worked without admin?
> 1. **Recovery** — terminal never gets stuck broken?
> 1. **Prompt flow** — can you actually paste `prompts/sprite.md` into ChatGPT, get a sprite, save it, and see it in the next run?
> 
> **Reply `done` if shipping, or list everything you want polished. I’ll patch and re-test.**

-----

## 10. Master Agent Final Reminders

- **Sub-agent briefs:** When spawning a sub-agent, give it (a) the relevant section(s) of this PRD, (b) the file paths it owns, (c) the acceptance criteria, (d) any cross-dependencies. Don’t dump the whole PRD.
- **Inter-agent contracts:** Before spawning agents that depend on each other (e.g., `mario-entity` needs `physics`), define the shared interfaces in a stub file first, then spawn both agents to fill in their sides against the contract.
- **Commit hygiene:** End each phase with `git add -A && git commit -m "phase N: <summary>"`. Commit DECISIONS.md updates inline.
- **Progress visibility:** Use TodoWrite at the start of each phase to enumerate the sub-agents and mark them as you go.
- **Refusal cases:** If a sub-agent’s brief is impossible (e.g., a missing dep, a Node version conflict), don’t fudge it. Surface the blocker in DECISIONS.md and continue with what’s possible.
- **Don’t over-engineer.** Iulian explicitly does not want bloat. Pick the simplest implementation that meets acceptance criteria.
- **No tests for the render loop.** Only test parsers, physics math, save store, palette logic. Visual stuff is checkpointed manually.
- **Iulian’s environment:** Windows 11 + PowerShell 7 + Windows Terminal + Node 20+. Test commands he’ll run will be PowerShell-style.

**Begin Phase 1 now. After each phase, commit, then either continue or stop at the marked checkpoint.**