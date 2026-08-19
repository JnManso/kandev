---
spec: docs/specs/prompt-paste-nerd-font-glyphs/spec.md
created: 2026-08-19
status: done
---

# Implementation Plan: Render Nerd Font glyphs pasted from a styled terminal

## Overview
Map Private Use Area codepoints to a Nerd Font through a `unicode-range` scoped
`@font-face`, preferring one the user already has and falling back to a small
subset shipped by Kandev. CSS and one font asset. No text is modified on any
path, so the bytes reaching the backend and the agent are unchanged.

## Confirmed root cause
The paste pipeline was never broken. TipTap, the WebSocket, SQLite and the
agent all carry the codepoints correctly; `U+E0B0` is transmitted as
`EE 82 B0`. The square is a render-time artifact.

Platform font-matching resolves missing glyphs for characters carrying a script
or language association (CJK, emoji), which is why those render unnamed.
Private Use codepoints carry none by definition, so the OS nominates no font
and the browser draws notdef. An explicitly named covering font is the only
mechanism that works.

`--font-sans` was `"Figtree", "Geist", ui-sans-serif, ...` with no `@font-face`
or `unicode-range` rule anywhere in `globals.css`. Kandev's Nerd Font presets
in `lib/terminal/terminal-font.ts` were wired only to `terminalFontFamily` and
referenced by zero chat components.

## Decision record: why not sanitize
An earlier implementation on this branch (reverted) stripped the Private Use
codepoints at paste time. It was rejected on review because **the agent may
need those characters**: a user pasting a prompt theme or powerline config is
often asking a question *about* those glyphs, and removing them deletes the
subject of the question. Review also found the stripping approach silently
discarded glyphs inside fenced code blocks, exactly where literal content must
survive.

| Option | Font | Modifies sent text | User sees | Agent receives |
|---|---|---|---|---|
| 0 (before) | no | no | notdef box | unchanged |
| 1 (reverted) | no | yes, at paste | glyphs removed | modified |
| **2 (chosen)** | **yes** | **no** | **glyphs** | **unchanged** |
| 3 | yes | yes, at send | glyphs | modified |

## Two defects found during implementation
Both were discovered by testing in a real browser rather than by reading the
CSS, and both are silent failures.

1. **`local()` does not match family names.** The first implementation named
   families (`local("MesloLGS NF")`) and rendered nothing at all. `local()`
   matches a full font name or PostScript name only. Measured in Chromium
   against an installed font: `local("MesloLGS NF")` produces notdef,
   `local("MesloLGS NF Regular")` produces the glyph. An unmatched source falls
   through silently, so the rule looks correct and does nothing.
2. **Ordering decided the winner arbitrarily.** Pasting the catalogue in
   alphabetical order handed the match to `MesloLGL` over `MesloLGS` purely on
   sort position. Harmless there (identical outlines) but wrong in general,
   since glyph shapes differ between families and the closest match to the
   user's terminal is preferred.

## Approach
1. `@font-face` named `NerdFontGlyphs` in `apps/web/app/globals.css`, scoped by
   `unicode-range` to the three PUA ranges, with `size-adjust: 75%` to bring
   the ~1.99x-cap-height separators down to roughly 1em.
2. `src` lists 68 `local()` entries covering all 66 Nerd Font families by full
   font name, ordered by intent, followed last by the bundled subset.
3. Bundled subset generated from the MIT-licensed `SymbolsNerdFont-Regular`
   v3.5.0 with `fontTools`, restricted to the four icon sets a prompt uses, and
   committed with its licence at
   `apps/web/public/fonts/nerd-symbols/`.
4. Family inserted into `--font-sans` and `--font-mono` after the UI typefaces.
5. Guard test covering the properties that silently regress.

### Subset size curve (measured, woff2)
| Ranges | Size |
|---|---|
| powerline only | 7 KB |
| + octicons | 33 KB |
| + seti/custom folders | 71 KB |
| **+ devicons (chosen)** | **236 KB** |
| + codicons | 280 KB |
| + Font Awesome | 472 KB |
| entire BMP PUA | 583 KB |

Font Awesome doubles the payload for icons prompts rarely draw, so the cut is
after devicons. The face is `unicode-range` scoped, so this is fetched only
when a Private Use codepoint is rendered.

## Tasks
- `task-01-pua-font-fallback.md` — `apps/web/app/globals.css`, bundled subset,
  guard test

## Validation
From `apps/web`:
```bash
pnpm vitest run app/globals-font-fallback.test.ts
pnpm run typecheck
pnpm lint
```

Measured against the running app rather than asserted:
- `U+E0B0`, `U+F418`, `U+E5FF` render the installed glyph, not notdef.
- Winner is `MesloLGS NF Regular`, matching the terminal's own font.
- Bundled subset alone (no `local()`) renders powerline, git branch, folder and
  devicon glyphs, proving the path for users with no Nerd Font.
- Separator drops from 1.99x to ~1.43x cap height under `size-adjust`.
- A/B of the stack with and without the fallback leaves Latin, accented, CJK,
  emoji and box-drawing widths byte-identical.

## Risks
- A Nerd Font outside the catalogue falls through to the bundled subset, so
  common glyphs still render but family-specific ones may not.
- Glyphs outside the subset (plane-15 Material Design, Font Awesome) remain
  notdef for users with no Nerd Font. Widening is a one-line range change at a
  known size cost, tabulated above.
- CSS has no unit-testable logic, so the guard asserts the declaration's shape.
  Rendering was verified by measuring glyph advance widths in a real browser.
