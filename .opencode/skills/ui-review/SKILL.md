---
name: ui-review
description: Dark mode coverage and UI consistency checks
---

## Dark mode must-have
Every `color` needs `isDark && styles.*Dark`:
- `isDark = useSettingsStore(s => s.settings.theme === 'dark')`
- Dark text: `'#333'`/`'#444'`/`'#555'` → dark `'#eee'` or `'#aaa'`
- Dark bg: `'rgba(255,255,255,0.72)'` → `'rgba(20,20,20,0.68)'`

## Empty states
- `'暂无数据'` / `'暂无消息'` / `'暂无记录'` / `'加载中...'`

## Placeholder
- `placeholderTextColor={isDark ? '#aaa' : '#5a5a5a'}`

## Buttons
- Primary: `bg:'#ff6f91'` white text `borderRadius:18`
- Back: pink text, left
- Refresh: pink text, right
