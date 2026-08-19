---
status: draft
created: 2026-08-19
owner: jnmanso
---

# Render Nerd Font glyphs pasted from a styled terminal

## Why
Text copied from a styled terminal prompt (Oh My Posh, Starship, any Nerd Font
setup) contains powerline separators and icon glyphs from the Unicode Private
Use Area. Pasted into a Kandev prompt input, each one renders as a notdef box
(square). Users read this as "Kandev deleted my character and replaced it with
a square".

Nothing is deleted, and nothing is corrupted. The paste, the editor, the
WebSocket, the database and the agent all handle the text correctly: `U+E0B0`
is transmitted as its correct UTF-8 encoding `EE 82 B0`. The failure is purely
at render time, because no font in the UI stack has a glyph for those
codepoints.

PUA codepoints cannot be resolved by platform font-matching the way CJK or
emoji are. Those carry a script and language association, so the OS can
nominate a covering font. The Private Use Area deliberately carries none:
`U+E0B0` means whatever the installed font decides. The OS has nothing to match
on, returns no font, and the browser draws notdef. A covering font must be
named explicitly, which is the same reason a user must configure their terminal
font to see powerline glyphs; installing the font is not sufficient.

## What
- Prompt inputs and message surfaces SHALL render Private Use Area codepoints
  as their intended glyphs.
- Resolution SHALL prefer a Nerd Font the user already has installed, and fall
  back to a subset shipped by Kandev when they have none.

### Font resolution order
- The `@font-face` SHALL list `local()` sources for the full Nerd Fonts
  catalogue (66 patched families), followed last by a `url()` source for the
  bundled subset. `src` is a prioritised list, so an installed font wins and no
  download occurs.
- Every `local()` entry SHALL name a **full font name** (family plus style, for
  example `MesloLGS NF Regular`) or a PostScript name. `local()` does not match
  family names: `local("MesloLGS NF")` fails silently where
  `local("MesloLGS NF Regular")` resolves. This is the inverse of the
  `font-family` property and the failure is invisible, since an unmatched
  source simply falls through.
- Ordering SHALL express intent rather than alphabetical accident, because
  glyph shapes differ between families and the closest match to the user's
  terminal is preferred: icons-only `Symbols`, then the Meslo variants that Oh
  My Posh and Powerlevel10k recommend, then common programming faces, then the
  remainder, with the non-Nerd `Cascadia Code` last as a Windows safety net.
- Patched family names are not derivable from the original typeface
  (`Source Code Pro` becomes `SauceCodePro`, `Cascadia Code` becomes
  `CaskaydiaCove`, `IBM Plex Mono` becomes `BlexMono`), so the catalogue is
  enumerated rather than inferred.

### Bundled subset
- Kandev SHALL ship a subset of `Symbols Nerd Font` (the icons-only Nerd Fonts
  build, MIT licensed) so users with no Nerd Font installed still see glyphs.
- The subset SHALL cover powerline separators (`U+E0A0-E0D4`), octicons
  (`U+F400-F533`), seti/custom file and folder icons (`U+E5FA-E6B7`), and
  devicons (`U+E700-E8EF`): the four sets an Oh My Posh prompt actually draws.
- The subset SHALL be served from the application's own origin, never a
  third-party CDN, which would leak that a user pasted terminal output and add
  a runtime dependency on someone else's uptime.
- Because the face is `unicode-range` scoped, the browser fetches it only when
  a Private Use codepoint is actually rendered. A user who never pastes
  terminal output downloads nothing.

### Stack coverage
- The glyph family SHALL be present in every font stack the stylesheet
  declares, not only the `--font-sans` and `--font-mono` variables.
  `.markdown-body` (rendered markdown across chat, PR and changelog) and
  `.chat-message-list` hardcode their own families rather than reading the
  variables, so a fix applied only to the variables leaves sent messages and
  agent output rendering notdef while the composer renders glyphs.

### Sizing
- The face SHALL carry a `size-adjust` descriptor. Powerline separators are
  drawn to fill a full terminal cell, ascender to descender, measuring ~1.99x
  the cap height of the UI typeface, and read as oversized blocks beside
  proportional text.

### Text sent to the agent is not modified
- The bytes delivered to the backend and the agent SHALL be byte-for-byte
  identical to before this feature. No sanitization, stripping, substitution,
  or normalization is applied to pasted text on any path.
- This is a hard requirement. Private Use codepoints may be meaningful to the
  agent: a user pasting a prompt theme, a powerline configuration, or terminal
  output may be asking about those exact characters, and removing them would
  delete the subject of the question.
- The implementation satisfies this by construction rather than by discipline:
  the feature is CSS only, and CSS cannot alter text content.

## Failure modes
- **No Nerd Font installed, glyph inside the bundled subset.** The bundled
  woff2 is fetched once and the glyph renders. Roughly 236 KB, cached, and
  never fetched by users who paste no PUA text.
- **No Nerd Font installed, glyph outside the subset.** Notdef box, as today.
  Affects the plane-15 Material Design range (`U+F0000-FFFFD`) and the Font
  Awesome block, both excluded to keep the download small. Widening is a
  one-line change to the subset ranges.
- **A Nerd Font installed that is absent from the catalogue.** The local
  sources miss, and resolution falls through to the bundled subset, so the
  common glyphs still render.
- **A font in the stack claims a PUA codepoint unexpectedly.** `unicode-range`
  scoping confines the face to the PUA, so no ordinary text can change
  appearance.

## Scenarios
- **GIVEN** a user with a Nerd Font installed, **WHEN** they paste an Oh My
  Posh prompt containing `U+E0B0`, **THEN** the separator renders using their
  own font, matching the terminal they copied from, and no font is downloaded.
- **GIVEN** a user with no Nerd Font installed, **WHEN** they paste the same
  text, **THEN** the bundled subset is fetched and the separator, git branch,
  folder and devicon glyphs render.
- **GIVEN** a user who never pastes Private Use text, **WHEN** they use the
  app, **THEN** the bundled subset is never requested.
- **GIVEN** any paste, **WHEN** the message is sent, **THEN** the backend and
  the agent receive exactly the same bytes as before this feature, including
  the Private Use codepoints.
- **GIVEN** ordinary text (accented Latin, CJK, emoji, box drawing), **WHEN**
  it is rendered, **THEN** it uses the existing UI typeface with unchanged
  metrics.
- **GIVEN** a maintainer edits the rule, **WHEN** a `local()` entry is reduced
  to a family name, the bundled source is moved ahead of the local sources, the
  `url()` is pointed at a third-party origin, or a Private Use range or
  `size-adjust` is dropped, **THEN** the guard test fails.

## Out of scope
- Shipping a complete Nerd Font. Only the icons-only subset is bundled, and
  only for the four icon sets a terminal prompt uses.
- Modifying, stripping, or normalizing pasted text on any path. Explicitly
  rejected: the agent must receive the characters.
- Rendering terminal background colours. Those are painted by the terminal and
  are not present in the clipboard as text; reproducing them would require ANSI
  parsing plus colour marks in the editor schema, a separate feature.
- Making the glyph font user-configurable. The terminal already exposes
  `terminalFontFamily`; a separate preference for the composer is not justified
  until someone asks for it.
