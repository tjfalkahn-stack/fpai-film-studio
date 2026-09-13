import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

export function renderLibraryFixture() {
  const component = fileURLToPath(new URL("../../src/ReferenceLibrary.jsx", import.meta.url));
  const model = fileURLToPath(new URL("../../src/characterReferences.js", import.meta.url));
  const { outputFiles } = buildSync({
    stdin: { contents: `
      import React from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import Library from ${JSON.stringify(component)};
      import { normalizeLibraryAsset, evaluateReferenceCoverage } from ${JSON.stringify(model)};
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#302244"/><circle cx="320" cy="230" r="100" fill="#b58cc9"/><path d="M150 580v-130a170 170 0 0 1 340 0v130" fill="#6d4f86"/></svg>';
      const refs = ["front", "three-quarter", "crying"].map((id, index) => normalizeLibraryAsset({
        id, filename: id + '-long-character-bible-reference-filename.png', width: 640, height: 640,
        contentHash: id, category: index === 2 ? "expression" : "identity_anchor", angle: index === 1 ? "three_quarter_left" : "front",
        expression: index === 2 ? "crying" : "", isPrimary: index === 0, isIdentityAnchor: index < 2,
        approvalState: "approved", assetUrl: 'data:image/svg+xml,' + encodeURIComponent(svg),
      }));
      module.exports = renderToStaticMarkup(<div className="drawer wide libraryDrawer" style={{position:"relative", transform:"none", width:"100%", maxHeight:"none"}}>
        <Library projectId="test" character={{ id:"test", name:"Local test fixture", referenceLibrary:refs, referenceCoverage:evaluateReferenceCoverage(refs), identityLock:{lockVersion:1,status:"stale",needsRebuild:true} }} getMedia={async()=>null} setDragTarget={()=>{}} />
      </div>);
    `, loader: "jsx", resolveDir: fileURLToPath(new URL("../../", import.meta.url)) },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false, logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

export function libraryFixturePage(width = 720) {
  const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
  const fixture = renderLibraryFixture();
  // Iframe viewport widths exercise media queries without browser emulation or
  // touching application state. All images are synthetic and all controls inert.
  const inner = `<!doctype html><html><head><style>${css}</style></head><body style="min-width:0;margin:0">${fixture}</body></html>`;
  return `<!doctype html><html><head><title>Character Bible local layout fixture</title></head><body style="margin:0;background:#08060d"><iframe title="${width}px reference library" width="${width}" height="1500" style="border:0" srcdoc="${inner.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe></body></html>`;
}
