// Bundles the Remotion composition once into ./bundle so the server can render
// without running esbuild/webpack at request time. Invoked at Docker build.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const outDir = path.join(projectRoot, "bundle");

console.log("Bundling composition → " + outDir);
const start = Date.now();

await bundle({
  entryPoint: path.join(projectRoot, "src", "index.ts"),
  outDir,
  publicDir: path.join(projectRoot, "public"),
  onProgress: (p) => {
    if (p % 25 === 0) console.log(`  ${p}%`);
  },
});

console.log(`Bundled in ${((Date.now() - start) / 1000).toFixed(1)}s`);
