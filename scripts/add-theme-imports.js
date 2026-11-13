const fs = require('fs');

const map = {
  'src/screens/ProfileScreen.tsx': "import { useSettingsStore, useMemberStore } from '../store';",
  'src/screens/FollowedRoomsScreen.tsx': "import { PerfFlatList } from '../components/PerfFlatList';",
  'src/screens/HomeScreen.tsx': "import { useMemberStore, useSettingsStore } from '../store';",
  'src/screens/LoginScreen.tsx': "import { useSettingsStore, useUiStore } from '../store';",
  'src/screens/SettingsScreen.tsx': "import { useSettingsStore, useUiStore, useMemberStore } from '../store';",
};

const IMPORT = "import { useAppTheme } from '../hooks/useAppTheme';";

for (const [f, anchor] of Object.entries(map)) {
  const src = fs.readFileSync(f, 'utf8');
  if (src.includes(IMPORT)) { console.log('already:', f); continue; }
  const out = src.replace(anchor, `${anchor}\n${IMPORT}`);
  fs.writeFileSync(f, out, 'utf8');
  console.log('imported:', f);
}
