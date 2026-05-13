---
name: react-native-perf
description: FlatList optimization, useMemo/useCallback, animation caps
---

## FlatList
Every FlatList needs: `initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews`

## Animation
FadeInView delay capped at 12: `delay={index < 12 ? 80 + index * 30 : 0}`

## Hooks
- Wrap renderItem in `useCallback(({ item }) => (...), [deps])`
- Wrap filtered/computed arrays in `useMemo(() => data.filter(...), [deps])`
- State based on prev → functional form: `setMsgs(prev => [...prev, x])`
