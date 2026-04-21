const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['renderer/app.js'],
  bundle: true,
  outfile: 'renderer/bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  minify: false,
  external: [],
});

console.log('Build complete: renderer/bundle.js');
