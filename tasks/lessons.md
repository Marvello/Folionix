# Lessons

## 2026-07-15 — Don't silently revert "drifted" state files at ship time
- During /ship, `.claude/ai-review-state.json` showed `last_processed_id: 2 → null`. I judged it accidental drift and reverted it. It was the user's intentional reset after truncating `weekly_reviews` (2 of 3 rows were broken).
- Rule: a state/config file change I didn't make is user work until proven otherwise. At commit time, either ask, or exclude it from the commit **without reverting the working tree**. `git restore --staged <file>` alone is fine; never follow with `git checkout -- <file>` on files I don't own.
