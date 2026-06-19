#!/usr/bin/env node

const esbuild = require('esbuild');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

esbuild
  .build({
    entryPoints: [path.join(root, 'src', 'webview', 'app', 'main.ts')],
    outfile: path.join(root, 'out', 'webview', 'main.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: false,
    sourcemap: false,
    legalComments: 'none'
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
