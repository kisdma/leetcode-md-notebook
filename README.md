# MLCS (MyLeetCodeSolutions)

MLCS adds a small helper toolbar to LeetCode problem pages. It captures the details you already see on the page—description, glossary snippets, test cases, and recent submissions—and lets you copy them as Markdown or download a Jupyter notebook for later review.

## Overview
- Collects the current problem statement, glossary notes, test data, and submission history into a single Markdown report.
- Builds a `.ipynb` notebook that includes a harness plus the latest code pulled from the editor, local storage, and recent submissions.
- Records when a custom “Run” input is detected and displays a badge so you know it will be included.

## Getting Started
1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. Add the MLCS userscript from this repository.
3. Visit any supported LeetCode problem or contest page and wait for the toolbar near the bottom-right corner.

## Using the Toolbar
- **Copy Report** places the Markdown summary on your clipboard.
- **Save .ipynb** downloads a notebook with the captured context and a reusable test harness.
- **Copy Log** copies a diagnostic log that can help when reporting issues.

## Practical Notes
- Run the problem at least once before copying or saving if you want custom input included.
- Keep the page open until the notebook download completes.
- No data leaves your browser; MLCS gathers information directly from the current page and LeetCode requests you initiate.

## FAQ
**Which sites are supported?**  Problem and contest pages on both leetcode.com and leetcode.cn.

**Does it change submissions?**  No. MLCS only reads content and structures it for export.

**Why the badge?**  It indicates that MLCS has seen a custom test case for the current problem.

## Credits
MLCS is maintained by everyday LeetCode users who wanted their scratch work and submissions in a reusable format. Suggestions and bug reports are welcome.
