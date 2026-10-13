import { build } from "esbuild"; import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync("test/out", {recursive: true});
await build({ entryPoints: ["test/test-entry.js"], bundle: true, format: "esm", outfile: "test/out/app.js", alias: {"firebase/firestore": "./test/fake-firestore.js"}, logLevel: "warning" });
const styles = readFileSync("src/styles.css","utf8"), body = readFileSync("src/body.html","utf8");
for (const mode of ["site","panel","popup","float"]) writeFileSync(`test/out/${mode}.html`, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body data-mode="${mode}">${body}<script type="module" src="app.js"></script></body></html>`);
console.log("test build ok");
