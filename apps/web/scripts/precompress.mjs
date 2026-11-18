// Writes a .br and a .gz next to every text file in the build, once, at the
// highest settings. The server sends whichever the browser accepts
// (@fastify/static's preCompressed), so a page loads a third of the bytes
// without compressing anything per request, even with no proxy in front.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dist = path.resolve(import.meta.dirname, "../dist");
const TEXT = /\.(js|mjs|css|html|svg|json|txt|xml|webmanifest|wasm)$/;
let files = 0;
let before = 0;
let after = 0;
for (const entry of fs.readdirSync(dist, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !TEXT.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  const data = fs.readFileSync(file);
  if (data.length < 1024) continue; // Too small to be worth a second request path.
  // The page itself stays plain: a deploy that copies only index.html must
  // never leave an older index.html.br behind to be served in its place.
  if (entry.name === "index.html") continue;
  const br = zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  fs.writeFileSync(`${file}.br`, br);
  fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }));
  files += 1;
  before += data.length;
  after += br.length;
}
console.log(
  `precompress: ${files} files, ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB with brotli`,
);
