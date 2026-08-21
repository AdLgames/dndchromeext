/**
 * Crops a PNG to a height, in place.
 *
 * Headless Chrome sizes its screenshot to the *window*, whose viewport is
 * ~87px shorter, so a shot framed for the Chrome Web Store's 1280×800 comes
 * out 1280×887 with a band of nothing at the bottom. No image library is
 * available here, and the bundled ffmpeg has no PNG decoder, so this does
 * the decode/refilter/encode by hand — it is a narrow job on files we
 * generate ourselves, always 8-bit and non-interlaced.
 *
 *   node scripts/crop-png.mjs <height> <file...>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function chunks(buf) {
  const out = [];
  let at = 8;
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    out.push({ type: buf.toString("ascii", at + 4, at + 8), data: buf.subarray(at + 8, at + 8 + length) });
    at += length + 12;
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Reverses the per-scanline filter PNG applies before compression. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (type === 1) value += a;
      else if (type === 2) value += b;
      else if (type === 3) value += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return out;
}

const [, , heightArg, ...files] = process.argv;
const wanted = Number(heightArg);
if (!wanted || !files.length) {
  console.error("usage: node scripts/crop-png.mjs <height> <file...>");
  process.exit(1);
}

for (const file of files) {
  const buf = readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file} is not a PNG`);

  const parts = chunks(buf);
  const ihdr = parts.find((c) => c.type === "IHDR").data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colour = ihdr[9];
  if (depth !== 8 || ihdr[12] !== 0) throw new Error(`${file}: only 8-bit non-interlaced PNGs`);
  if (height <= wanted) { console.log(`${file}: already ${width}x${height}`); continue; }

  const bpp = CHANNELS[colour];
  const raw = inflateSync(Buffer.concat(parts.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const pixels = unfilter(raw, width, height, bpp);

  // Re-emit the kept rows with filter type 0, which is always valid.
  const stride = width * bpp;
  const out = Buffer.alloc((stride + 1) * wanted);
  for (let y = 0; y < wanted; y++) {
    out[y * (stride + 1)] = 0;
    pixels.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.from(ihdr);
  header.writeUInt32BE(wanted, 4);
  writeFileSync(file, Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(out, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
  console.log(`${file}: ${width}x${height} -> ${width}x${wanted}`);
}
