#!/usr/bin/env node
// electron/fetch-vendor.js — Descarga las librerías de CDN a vendor/ para uso offline.
// Ejecutar una sola vez: node fetch-vendor.js
// (o cuando se actualicen las versiones de las dependencias)

import https    from 'https';
import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';

const VENDOR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor');
fs.mkdirSync(VENDOR_DIR, { recursive: true });

const LIBS = [
  {
    url:  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    dest: 'chart.umd.min.js',
  },
  {
    url:  'https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js',
    dest: 'hammer.min.js',
  },
  {
    url:  'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js',
    dest: 'chartjs-plugin-zoom.min.js',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} para ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

for (const { url, dest } of LIBS) {
  const filePath = path.join(VENDOR_DIR, dest);
  process.stdout.write(`Descargando ${dest}... `);
  try {
    await download(url, filePath);
    console.log('✓');
  } catch (e) {
    console.error('✗', e.message);
    process.exit(1);
  }
}

console.log('✓ Vendor listo en', VENDOR_DIR);
