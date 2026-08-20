import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GLYPH_FAMILY = "NerdFontGlyphs";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

// Slice to the rule's closing brace rather than a fixed character budget: a
// fixed window silently truncates as the rule grows, which already caused a
// descriptor to read as absent when it was present.
const faceStart = css.indexOf("@font-face");
const fontFace = css.slice(faceStart, css.indexOf("}", faceStart) + 1);

/** The first real font stack declared for `name`, sliced to its terminating
 *  semicolon.
 *
 *  Two traps here. A fixed character budget silently truncates as a stack
 *  grows, so the slice ends at the semicolon. And the first textual match is
 *  the Tailwind `@theme inline` alias (`--font-sans: var(--font-sans);`),
 *  which contains no families at all, so `var()`-only values are skipped. */
const declaration = (name: string) => {
  let from = 0;
  for (;;) {
    const start = css.indexOf(name, from);
    if (start === -1) throw new Error(`no font stack found for ${name}`);
    const end = css.indexOf(";", start) + 1;
    const text = css.slice(start, end);
    if (!/:\s*var\([^;]*\);$/.test(text.replace(/\s+/g, " "))) return text;
    from = end;
  }
};

describe("Nerd Font PUA glyph fallback", () => {
  it("declares a font-face for the private use area", () => {
    expect(css).toContain(GLYPH_FAMILY);
    expect(fontFace).toContain("@font-face");
  });

  it("covers all three private use ranges", () => {
    expect(fontFace).toContain("U+E000-F8FF");
    expect(fontFace).toContain("U+F0000-FFFFD");
    expect(fontFace).toContain("U+100000-10FFFD");
  });

  it("prefers an installed font and falls back to the bundled subset", () => {
    const sources = fontFace.slice(fontFace.indexOf("src:"));
    const lastLocal = sources.lastIndexOf("local(");
    const bundled = sources.indexOf("url(");

    expect(lastLocal).toBeGreaterThan(-1);
    expect(bundled).toBeGreaterThan(-1);
    // Order is load-bearing. `src` is a prioritised list, so a user who owns a
    // Nerd Font matches locally and never fetches anything, and their glyphs
    // match the terminal they copied from. The download only happens when no
    // local source matched.
    expect(bundled).toBeGreaterThan(lastLocal);
  });

  it("serves the bundled subset from the app, not a third-party CDN", () => {
    // A remote origin would leak that a user pasted terminal output, and add a
    // runtime dependency on someone else's uptime.
    const urls = [...fontFace.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^\/fonts\//);
  });

  it("names every source by full font name, not by family name", () => {
    // `local()` matches a full font name or PostScript name only. A family
    // name silently fails and falls through to the next source, so an entry
    // like local("MesloLGS NF") looks correct and renders nothing. Verified
    // against Chromium: "MesloLGS NF" fails, "MesloLGS NF Regular" resolves.
    const sources = [...fontFace.matchAll(/local\("([^"]+)"\)/g)].map((m) => m[1]);

    expect(sources.length).toBeGreaterThan(1);
    for (const source of sources) {
      // Most patched families spell their full name as "<family> Regular".
      // The icons-only font is the documented exception: it reports full name
      // "Symbols Nerd Font" and PostScript name "SymbolsNF", verified by
      // reading the shipped subset's name table.
      const hasStyleSuffix = /\b(Regular|Mono|Book|Medium)$/.test(source);
      const isKnownStyleless = source === "Symbols Nerd Font" || source === "SymbolsNF";
      expect(hasStyleSuffix || isKnownStyleless).toBe(true);
    }
  });

  it("lists only Nerd Font patched faces, never an unpatched base font", () => {
    // A resolved local() commits the browser to that face for the whole
    // unicode-range; it does not fall through per-glyph. An unpatched base
    // font therefore preempts the bundled subset and renders fewer glyphs
    // than listing nothing. Unpatched Cascadia Code shipped here once and
    // covers 0 of the powerline, seti, devicon and octicon codepoints.
    const sources = [...fontFace.matchAll(/local\("([^"]+)"\)/g)].map((m) => m[1]);

    for (const source of sources) {
      const isPatched = /Nerd Font|\bNF\b/.test(source) || source === "SymbolsNF";
      expect(isPatched, `${source} is not a Nerd Font patched face`).toBe(true);
    }
  });

  it("uses swap font-display so text is never invisible while the subset loads", () => {
    // Without it the browser blocks rendering for up to 3s on a slow
    // connection, hiding the surrounding text as well as the glyphs.
    expect(fontFace).toContain("font-display: swap");
  });

  it("scales the glyphs down to sit inline with proportional text", () => {
    // Powerline separators fill a full terminal cell, so unscaled they render
    // at roughly twice the cap height of the UI face. Measured 1.99x before
    // this descriptor, 1.43x after.
    expect(fontFace).toMatch(/size-adjust:\s*\d+%/);
  });

  it("is reachable from every font stack in the stylesheet", () => {
    // Asserting two named stacks was not enough: .markdown-body and
    // .chat-message-list hardcode their own families instead of reading the
    // variables, so rendered chat messages kept showing notdef boxes while the
    // composer rendered glyphs. Scan every stack rather than a chosen few.
    const outsideFontFace = css.slice(0, faceStart) + css.slice(css.indexOf("}", faceStart));
    const stacks = [...outsideFontFace.matchAll(/(?:font-family|--font-[a-z-]+):\s*([^;]+);/g)]
      .map((m) => ({ value: m[1].replace(/\s+/g, " ").trim() }))
      .filter((s) => !s.value.startsWith("var(") && /[,]/.test(s.value));

    expect(stacks.length).toBeGreaterThan(3);
    for (const stack of stacks) {
      expect(stack.value).toContain(GLYPH_FAMILY);
    }
  });

  it("keeps the UI typeface ahead of the glyph fallback for ordinary text", () => {
    const sans = declaration("--font-sans:");

    expect(sans.indexOf("Figtree")).toBeLessThan(sans.indexOf(GLYPH_FAMILY));
  });
});
