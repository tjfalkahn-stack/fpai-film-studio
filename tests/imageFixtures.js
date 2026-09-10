import { deflateSync } from "node:zlib";

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function makePng(width = 64, height = 64, { r = 180, g = 70, b = 90, salt = "" } = {}) {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const i = row + 1 + x * 3;
      raw[i] = (r + x + y) & 255;
      raw[i + 1] = (g + x) & 255;
      raw[i + 2] = (b + y) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
  ];
  if (salt) chunks.push(pngChunk("tEXt", Buffer.from(`Comment\0${salt}`)));
  chunks.push(pngChunk("IDAT", deflateSync(raw)));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

export function makeJpeg(width = 64, height = 64, salt = 0) {
  const header = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x0b,
    0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xfe, 0x00, 0x04, salt & 0xff, 0x00,
    0xff, 0xd9,
  ]);
  return header;
}

export function makeWebp(width = 64, height = 64, salt = 0) {
  const payload = Buffer.alloc(10, 0);
  payload[0] = salt & 0xff;
  const w = width - 1;
  const h = height - 1;
  payload[4] = w & 0xff;
  payload[5] = (w >> 8) & 0xff;
  payload[6] = (w >> 16) & 0xff;
  payload[7] = h & 0xff;
  payload[8] = (h >> 8) & 0xff;
  payload[9] = (h >> 16) & 0xff;
  const vp8x = Buffer.concat([Buffer.from("VP8X"), Buffer.alloc(4), payload]);
  vp8x.writeUInt32LE(10, 4);
  const riff = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), vp8x]);
  riff.writeUInt32LE(riff.length - 8, 4);
  return riff;
}
