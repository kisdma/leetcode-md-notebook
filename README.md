# MLCS (MyLeetCodeSolutions)

*A focused companion for documenting problems, preserving attempts, and exporting shareable notebooks.*

## Overview
MLCS wraps each LeetCode problem page with a lightweight workspace: one click gathers a polished Markdown snapshot and an executable Jupyter notebook. It keeps track of custom runs, surfaces your recent submissions, and packages everything into a format you can review, study from, or share with teammates.

## Highlights
- Rich summaries in seconds: copy a neatly formatted Markdown report that captures the full description, glossary notes, test cases, and recent submissions.
- Ready-to-run notebooks: export a `.ipynb` file that opens with a shared harness and your latest code, so you can continue experimenting offline.
- Custom run awareness: the toolbar badge reminds you when the current problem already has captured inputs from the Run button.
- Gentle UI: a compact floating toolbar keeps actions within reach without interfering with solving.

## Getting Started
1. Install your preferred userscript manager (Tampermonkey, Violentmonkey, or similar).
2. Add the MLCS userscript from this repository.
3. Visit any LeetCode problem or contest page and wait for the toolbar near the bottom-right corner.

## Daily Workflow
- Click **Copy Report** to place a complete write-up on your clipboard. Paste it into notes, pull requests, or study journals.
- Choose **Save .ipynb** to download a notebook containing the description, harness, and recent solutions.
- Use **Copy Log** when you need a quick diagnostic snapshot while debugging.
- Check the badge to confirm whether custom inputs from the Run button have been captured for this problem.

## Tips for a Smooth Experience
- Run at least once before copying or saving so custom input is included.
- Keep the problem page open until the notebook download finishes.

## Frequently Asked Questions
**Does it work on both leetcode.com and leetcode.cn?**  Yes. Problem and contest pages on either site are supported.

**Will it change my submissions?**  No. It only reads data already available in the page and formats it for export.

**Is any information sent elsewhere?**  Everything stays in your browser. MLCS simply organises what LeetCode already provides.

## Thanks
MLCS began as an evening productivity experiment and has grown with feedback from solvers who wanted better notes, richer discussions, and smoother handoffs. Enjoy the workflow and keep shipping solutions!
