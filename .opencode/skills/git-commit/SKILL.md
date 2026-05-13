---
name: git-commit
description: Safe git commit flow with TypeScript check
---

## Flow
1. `npx tsc --noEmit` — if errors exist, fix first, don't commit
2. Check `git status` to verify what's staged
3. Commit with conventional format: `type: what changed`
4. Push to main: `git push origin main`

## NEVER
- Force push to main
- Commit `.env`, `node_modules/`, `android/build/`
- Skip TypeScript check before commit

## If GitHub unreachable
- Retry once, then suggest proxy or wait
- Commit is saved locally
