const fs = require('fs');
const s = fs.readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const keys = [...s.matchAll(/^\s+(\w+):\s*\{/gm)].map((m) => m[1]);
const body = s.replace(/styles\.\w+:\s*\{[^}]*\},?/g, '');
const unused = keys.filter((k) => !new RegExp('styles\\.' + k + '(?![\\w])').test(body));
console.log('unused styles:', unused.join(', ') || '(none)');
