/**
 * Convert SVG icon to multi-size ICO file.
 * Usage: node scripts/svg-to-ico.mjs
 * Input:  logo/patty-icon.svg
 * Output: logo/patty-icon.ico, resources/icon.ico
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = resolve(ROOT, 'logo/patty-icon.svg');
const ICO_OUT = resolve(ROOT, 'logo/patty-icon.ico');
const RES_OUT = resolve(ROOT, 'resources/icon.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

function buildIco(entries) {
  const headerLen = 6;
  const dirLen = entries.length * 16;
  let dataOffset = headerLen + dirLen;
  const dir = [];
  const pngs = [];

  for (const { size, png } of entries) {
    dir.push({
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      colors: 0, reserved: 0, planes: 1, bpp: 32,
      size: png.length, offset: dataOffset,
    });
    pngs.push(png);
    dataOffset += png.length;
  }

  const buf = Buffer.alloc(headerLen + dirLen + pngs.reduce((s, p) => s + p.length, 0));
  buf.writeUInt16LE(0, 0);
  buf.writeUInt16LE(1, 2);
  buf.writeUInt16LE(entries.length, 4);

  let off = headerLen;
  for (const d of dir) {
    buf.writeUInt8(d.width, off);
    buf.writeUInt8(d.height, off + 1);
    buf.writeUInt8(d.colors, off + 2);
    buf.writeUInt8(d.reserved, off + 3);
    buf.writeUInt16LE(d.planes, off + 4);
    buf.writeUInt16LE(d.bpp, off + 6);
    buf.writeUInt32LE(d.size, off + 8);
    buf.writeUInt32LE(d.offset, off + 12);
    off += 16;
  }
  for (const png of pngs) {
    png.copy(buf, off);
    off += png.length;
  }
  return buf;
}

// Write Electron render script
const outDir = resolve(tmpdir(), 'patty-icon-gen');
mkdirSync(outDir, { recursive: true });

const electronScript = `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = fs.readFileSync(${JSON.stringify(SVG_PATH)}, 'utf-8');
const sizes = ${JSON.stringify(SIZES)};
const outDir = ${JSON.stringify(outDir)};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256,
    show: false,
    webPreferences: { offscreen: true }
  });

  for (const size of sizes) {
    const scaledSvg = SVG
      .replace(/width="512"/, 'width="' + size + '"')
      .replace(/height="512"/, 'height="' + size + '"');
    const html = '<html><body style="margin:0;padding:0;background:transparent;overflow:hidden">' + scaledSvg + '</body></html>';
    await win.loadURL('data:text/html,' + encodeURIComponent(html));
    // Wait for render
    await new Promise(r => setTimeout(r, 200));
    const png = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, size + '.png'), png.toPNG());
    console.log(size + 'x' + size + ' — ' + png.length + ' bytes');
  }

  app.quit();
});
`;

const scriptPath = resolve(tmpdir(), 'patty-icon-render.js');
writeFileSync(scriptPath, electronScript);

console.log('Rendering SVG to PNGs via Electron...');
try {
  execSync(`npx electron "${scriptPath}"`, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: 30000,
  });
} catch {
  console.error('Electron render failed. Check that electron is installed.');
  process.exit(1);
}

// Build ICO from rendered PNGs
console.log('\nBuilding ICO...');
const entries = SIZES.map(size => ({
  size,
  png: readFileSync(resolve(outDir, size + '.png')),
}));

const ico = buildIco(entries);
writeFileSync(ICO_OUT, ico);
copyFileSync(ICO_OUT, RES_OUT);

console.log('\nDone!');
console.log('  ' + ICO_OUT);
console.log('  ' + RES_OUT);
