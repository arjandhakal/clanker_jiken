// Dependency-free PNG generation. Supersampling keeps the toolbar mark crisp.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc = data => {
  let value = 0xffffffff;
  for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const body = Buffer.concat([Buffer.from(name), data]);
  const head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
};
const segments = [[31,85,36,46],[36,55,46,46],[46,46,56,47],[56,47,60,57],[60,57,56,85],[60,57,71,46],[71,46,81,47],[81,47,87,56],[87,56,83,85]];
function lineDistance(x, y, [ax, ay, bx, by]) {
  const t = Math.max(0, Math.min(1, ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
  return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay));
}
mkdirSync('extension/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rgba = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x+(sx+.5)/4)/size*128, py = (y+(sy+.5)/4)/size*128;
      const dx = Math.max(24-px, 0, px-104), dy = Math.max(24-py, 0, py-104);
      if (dx*dx+dy*dy > 24*24) continue;
      const ink = segments.some(s => lineDistance(px, py, s) < 5.5);
      const color = ink ? [249,248,231] : [82,100,68];
      for (let c=0;c<3;c++) rgba[c] += color[c]/16;
      rgba[3] += 255/16;
    }
    const offset = y*(size*4+1)+1+x*4;
    for (let c=0;c<4;c++) pixels[offset+c] = Math.round(c < 3 && rgba[3] ? rgba[c]*255/rgba[3] : rgba[c]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size,0); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  writeFileSync(`extension/icons/${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Generated Margin icons.');
