import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderLibraryFixture } from "./fixtures/character-bible-ui.js";

test("reference cards render hydrated coverage, images and all controls without inheriting primary-button layout", () => {
  const html = renderLibraryFixture();
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.match(html, /libraryCard isPrimary/);
  assert.doesNotMatch(html, /class="libraryCard primary/);
  assert.equal((html.match(/class="libraryThumb"/g) || []).length, 3);
  assert.equal((html.match(/aria-label="Select /g) || []).length, 3);
  assert.match(html, /Reference Coverage/);
  assert.match(html, /rebuild required after reference changes/);
  assert.match(html, /Rebuild Character Lock/);
  assert.match(html, /writes a versioned reference manifest only/);
});

test("card CSS bounds thumbnail height, allows action wrapping, and collapses columns at narrow widths", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.libraryGrid\{[^}]*auto-fit[^}]*align-items:start/);
  assert.match(css, /\.libraryCard\{[^}]*flex-direction:column[^}]*min-width:0/);
  assert.match(css, /\.libraryThumb\{[^}]*height:190px/);
  assert.match(css, /\.libraryThumb img\{[^}]*height:100%[^}]*object-fit:contain/);
  assert.match(css, /\.libraryActions\{[^}]*flex-wrap:wrap/);
  assert.match(css, /@media\(max-width:540px\)\{\.libraryFilters\{grid-template-columns:repeat\(2/);
});
