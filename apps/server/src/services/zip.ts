import { crc32 } from "node:zlib";

/**
 * A minimal store-only (uncompressed) ZIP writer.
 *
 * Frames are WebP, JPEG, AVIF or PNG — already compressed. Deflating them
 * spends CPU to save approximately nothing, so storing them verbatim is both
 * faster and simpler, and it keeps this small enough to read in one sitting
 * rather than pulling in an archiving dependency for one download button.
 *
 * Deliberately limited: no compression, no ZIP64, no directory entries, no
 * unicode path extras. Names are ASCII (`frame_0001.webp`, `manifest.json`),
 * and a set is bounded well under 4 GiB, so none of those are reachable.
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** Written verbatim; readers use it only for a filesystem timestamp. */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01, the ZIP epoch.

export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "ascii");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed — identical when stored
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0o644 << 16, 38); // external attrs: a regular file
    central.writeUInt32LE(offset, 42); // where its local header starts
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralDirectory, end]);
}
