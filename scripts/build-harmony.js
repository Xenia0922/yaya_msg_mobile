const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

async function buildHarmonyBundle(options = {}) {
  const {
    dev = false,
    entryFile = 'index.harmony.ts',
    bundleOutput = path.join('harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'bundle.harmony.js'),
    platform = 'harmony',
    minify = !dev,
  } = options;

  process.chdir(PROJECT_ROOT);
  const metro = require('metro');

  console.log(`[build:harmony] Root: ${PROJECT_ROOT}`);
  console.log(`[build:harmony] Entry: ${entryFile}`);
  console.log(`[build:harmony] Output: ${bundleOutput}`);
  console.log(`[build:harmony] Dev: ${dev}, Minify: ${minify}`);

  const outPath = path.resolve(PROJECT_ROOT, bundleOutput);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const metroConfig = await metro.loadConfig();
  const result = await metro.runBuild(metroConfig, {
    entry: entryFile,
    platform,
    dev,
    minify,
  });

  fs.writeFileSync(outPath, result.code);
  console.log(`[build:harmony] Done: ${outPath} (${Buffer.byteLength(result.code, 'utf8')} bytes)`);
}

const args = process.argv.slice(2);
buildHarmonyBundle({ dev: args.includes('--dev') }).catch((err) => {
  console.error('[build:harmony] Error:', err.message);
  process.exit(1);
});
