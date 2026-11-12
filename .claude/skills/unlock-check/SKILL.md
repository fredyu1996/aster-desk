---
name: unlock-check
description: Check that today's token-unlock calendar reached the desk repo (the claude.ai "Aster unlock calendar research" task pushes unlocks.json around 4:32 AM America/Creston), and if it didn't, research and publish it from here. Use when Fred asks about the unlock calendar, "unlock 更新咗未", a stale unlock guard, or at the start of a session on this repo after 4:32 AM Creston.
---

# Unlock calendar check / publish

`unlocks.json` feeds the unlock guard: the traders won't open positions into a big token unlock. The desk re-fetches it every 6 h, and a snapshot is embedded at build time. A stale calendar means the guard is blind.

## 1 · Check (always; cheap)
```bash
git pull --rebase --autostash
git log -3 --format='%h %ad %s' --date=iso -- unlocks.json
```
- **Fresh** = any commit touching `unlocks.json` dated after 4:32 AM today, America/Creston (UTC−7, no DST).
  - Judge by the date, not the title: past titles vary ("unlock calendar <date>", "Unlock calendar: publish…", hand-off commits).
  - If fresh → report "已更新 (<hash>, <n> events)" and stop.
- **Missing** → the daily task's push failed (it happened on Nov 12). Go to step 2.

## 2 · Publish (only if missing)
1. **Ask Fred first.** He may prefer to re-run the claude.ai task. Then do the research unless he says otherwise.
2. **Research.** Find upcoming unlocks for the coins Aster lists, for roughly the next 30 days, using web search (firecrawl). Delegate the research to a subagent per the global dispatch rules: it is more than 2 fetches.
   - Prefer primary sources (project docs, tokenomist / token.unlocks pages).
   - Record the source for each event.
3. **Match the existing schema exactly.** Before writing, read the top of the current `unlocks.json` and `src/unlock.js`, which consumes it. Keep the same field names, units and date format. Don't invent fields.
4. **Merge.** Drop events that have passed. Update the changed ones and add the new ones. Never delete future events you couldn't re-confirm: keep them as they are.
5. **Build and test.** The PostToolUse hook rebuilds automatically after editing `unlocks.json`. Also run `npm test` (the push hook runs it too).
6. **Commit and push.** Commit `unlocks.json` with `index.html` and `bot/core.js`, message `unlock calendar <YYYY-MM-DD>`. Then `git push`.
7. **Verify.** `git log -1 origin/main -- unlocks.json` shows your commit.

## Report (Cantonese, short)
- Fresh or not.
- If published: how many events, the next 3 big ones (coin, date, % of supply), and which ones you couldn't confirm.
