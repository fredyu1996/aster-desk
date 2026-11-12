---
name: read-my-reviews
description: Read Fred's own trade reviews (comments, chart-picture captions, pictures) from the notes branch of aster-desk-data and save Claude's reading (`rd`) on each one, so the Reviewer uses it. Use when Fred says "讀吓我啲 review", "read my reviews", "睇吓我啲 review", or asks Claude to go through his manual reviews.
---

# Read Fred's reviews → `rd` readings

The Reviewer turns Fred's reviews into rules. Its phrase reader (`youRead`) is crude. A reading by Claude (`rd`) replaces it, but only while the text is unchanged (`youReadM` in `src/review.js`). This skill writes those readings.

## Boundaries
- **Paper trading only.** Never touch the `state` branch, strategy code or `CFG` here. This skill writes `rd` fields on the `notes` branch and nothing else.
- **`gh` path.** In Git Bash `gh` is not on PATH (a broken PATH entry). Call it as `"/c/Program Files/GitHub CLI/gh.exe"`; PowerShell can use `gh`.
- **No tokens in chat or files.** Use the `gh` CLI's existing login. If `gh` can't read `fredyu1996/aster-desk-data`, stop and tell Fred. Never ask him to paste a token.
- **Pictures are his course or screen material.** Describe what they show; never reproduce course content.

## Steps

1. **Fetch** `manual-reviews.json` from branch `notes` of the private repo `fredyu1996/aster-desk-data`. Keep the blob `sha` for the write.
   ```bash
   gh api "repos/fredyu1996/aster-desk-data/contents/manual-reviews.json?ref=notes" > "$SCRATCH/mr.json"
   # content is base64 in .content; decode it with node, not jq (jq is not installed)
   ```
   The file is a map: key (`pt|sm` + symbol + exit time) → review record (`note`, `imgs: [{cap, …}]`, `plan`, grade, `rd`, …).

2. **Choose what to read.** Read every record where `mineText(m)` is non-empty, unless it already has an `rd` whose `n` still equals `mineText(m).length`.
   - `mineText(m)` is `m.note` plus each `imgs[i].cap`, with blanks dropped, joined with `". "`.
   - The exact definition is in `src/review.js` (search `const mineText`). Re-check it there before computing `n`.

3. **Look at the pictures** when a record has them: `img/*.jpg` on the same branch (`gh api …/contents/img/<name>?ref=notes`). Save them to the scratchpad and view them with Read.

4. **Write the reading** for each record:
   ```
   rd: {a: [...], b: [...], d: [...], txt: "1–2 sentences", n: <mineText(m).length>, t: <Date.now()>, by: "Claude"}
   ```
   Allowed keys (no others; the Reviewer ignores unknown ones):
   - `a` = what he'd have done: `same, flip, skip, later, earlier, exitE, hold, wider, tighter, bigger, smaller`
     - `flip` = he says it should have been the other side.
     - Side-aware: "should have been a short" on a long → `flip`.
   - `b` = part that was poor: `draw, cont, poi, room, htf, ob, gap, sweep, depth`
   - `d` = part that was fine / holds a rule: `smc_gap, smc_ob, smc_htf, smc_poi, smc_path, smc_draw, tight, quickstop, forming`

   Only mark what he actually says or clearly draws. An empty list is fine. `txt` is plain English, written for Fred.

5. **Save** with read → merge → write. Other computers save to the same branch.
   - Re-fetch the file right before writing.
   - Merge: set only `rd` on the records you read.
   - PUT it back with the fresh `sha` and the commit message `Claude readings: <n> reviews`.
   - On a 409 or sha mismatch: re-fetch, re-merge, retry (max 3).

6. **Verify.** Fetch the file again and confirm each `rd` you wrote is there and its `n` matches.

## Report to Fred (Cantonese, short)
- How many reviews were read and how many skipped (already read, or no text).
- The tally of `a` points, e.g. "other side 3 (KOMA, AKE, LYN), enter later 2".
- Which tallies now cross the rule threshold. A point counts at 2 and ≥ ⅓ of his reviews that say anything, or at 3 regardless.
- When it takes effect: the cloud reads the notes each cycle, so SMC rules update within ~5 min. The Trader re-reviews after 2 new Trader reviews.
- Say plainly when a sample is too small to mean much.
