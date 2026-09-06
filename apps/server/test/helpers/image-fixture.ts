import { randomFillSync } from "node:crypto";
import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write(type, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])));
  return Buffer.concat([header, data, checksum]);
}
/** A real, decodable PNG; never represented as a model-generated sample. */
export function imageFixture(width = 1024, height = 1024) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = 170 + Math.floor((x / width) * 50);
      pixels[offset + 1] = 150 + Math.floor((y / height) * 60);
      pixels[offset + 2] = 130;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A real, decodable PNG close to a chosen encoded size. Random pixels defeat
 * deflate, so the file stays large; a gradient would compress to a few KB and
 * prove nothing about payload limits. Kept within the 4096px decode ceiling. */
export function largeImageFixture(targetBytes: number) {
  // Random RGB deflates to roughly its raw size, so pick the side length from
  // the target and verify the result rather than trusting the estimate.
  // Stored-mode deflate adds ~5 bytes per 64 KB block, and PNG adds its chunk
  // headers, so aim slightly under the target to land beneath it rather than
  // just over the limit the caller is testing against.
  const side = Math.min(4096, Math.floor(Math.sqrt((targetBytes * 0.99) / 3)));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(side * (side * 3 + 1));
  for (let y = 0; y < side; y++) randomFillSync(pixels, y * (side * 3 + 1) + 1, side * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
