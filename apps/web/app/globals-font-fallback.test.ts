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

/** The value of a CSS custom property declaration, from its name onwards. */
const declaration = (name: string) => css.slice(css.indexOf(name), css.indexOf(name) + 220);

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
      // Either carries a style suffix, or is a single-family face whose full
      // name legitimately has no style word (e.g. "Cascadia Code").
      const hasStyleSuffix = /\b(Regular|Mono|Book|Medium)$/.test(source);
      const isKnownStyleless = source === "Cascadia Code";
      expect(hasStyleSuffix || isKnownStyleless).toBe(true);
    }
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
