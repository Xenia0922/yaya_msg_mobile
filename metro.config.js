const { getDefaultConfig } = require('expo/metro-config');
const pathUtils = require('path');
const fs = require('fs');

const HARMONY_PLATFORM = 'harmony';
const RNOH_PACKAGE = '@react-native-oh/react-native-harmony';

const expoConfig = getDefaultConfig(__dirname);
expoConfig.resolver.assetExts.push('wasm');

// Capture the original resolveRequest chain (from expo or metro default)
const _originalResolve = expoConfig.resolver.resolveRequest;

// Cache harmony package aliases from node_modules
let _harmonyAliases = null;
function harmonyAliases() {
  if (_harmonyAliases) return _harmonyAliases;
  _harmonyAliases = {};
  const nodeModules = pathUtils.resolve('node_modules');
  if (!fs.existsSync(nodeModules)) return _harmonyAliases;
  for (const name of fs.readdirSync(nodeModules)) {
    const p = pathUtils.join(nodeModules, name);
    if (!fs.statSync(p).isDirectory()) continue;
    if (name.startsWith('@')) {
      try {
        for (const sub of fs.readdirSync(p)) {
          addAlias(pathUtils.join(p, sub), `${name}/${sub}`);
        }
      } catch {}
    } else {
      addAlias(p, name);
    }
  }
  return _harmonyAliases;
}

function addAlias(dirPath, pkgName) {
  const pkgPath = pathUtils.join(dirPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.harmony?.alias) {
      _harmonyAliases[pkg.harmony.alias] = pkgName;
    }
  } catch {}
}

function getPackageName(moduleName) {
  if (moduleName.startsWith('.')) return null;
  if (moduleName.startsWith('@')) {
    const seg = moduleName.split('/', 3);
    return seg.length >= 2 ? `${seg[0]}/${seg[1]}` : moduleName;
  }
  return moduleName.includes('/') ? moduleName.split('/')[0] : moduleName;
}

function harmonyResolveRequest(ctx, moduleName, platform) {
  // Resolve via original chain first, then fall back
  const resolve = (ctx2, name, plat) => {
    if (_originalResolve) {
      return _originalResolve(ctx2, name, plat);
    }
    return ctx2.resolveRequest(ctx2, name, plat);
  };

  // Pass through non-harmony platforms to original resolver
  if (platform !== HARMONY_PLATFORM) {
    return resolve(ctx, moduleName, platform);
  }

  // Redirect react-native -> react-native-harmony
  if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    try {
      return resolve(ctx, moduleName.replace('react-native', RNOH_PACKAGE), HARMONY_PLATFORM);
    } catch {
      return resolve(ctx, moduleName, 'ios');
    }
  }

  // Prefer .harmony.ts over .ios.ts
  if (ctx.sourceExts) {
    for (const ext of ctx.sourceExts) {
      try {
        const result = resolve({ ...ctx, sourceExts: [ext] }, moduleName, HARMONY_PLATFORM);
        if (result.type === 'sourceFile') {
          const lastDot = result.filePath.lastIndexOf('.');
          if (result.filePath.substring(0, lastDot).endsWith('.' + HARMONY_PLATFORM)) {
            return result;
          }
        }
      } catch {}
    }
  }

  // Redirect third-party harmony aliases
  const packageName = getPackageName(moduleName);
  if (packageName) {
    const aliases = harmonyAliases();
    const harmonyPkg = aliases[packageName];
    if (harmonyPkg) {
      try {
        return resolve(ctx, moduleName.replace(packageName, harmonyPkg), platform);
      } catch {}
    }
  }

  return resolve(ctx, moduleName, platform);
}

module.exports = {
  ...expoConfig,
  server: {
    ...expoConfig.server,
    enhanceMiddleware: (middleware, server) => {
      return (req, res, next) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          url.searchParams.get('platform');
        } catch {}
        return middleware(req, res, next);
      };
    },
  },
  transformer: {
    ...expoConfig.transformer,
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    ...expoConfig.resolver,
    resolveRequest: harmonyResolveRequest,
  },
};
