# GitHub Wiki publishing

The GitHub Wiki is a generated public mirror of Minnow's versioned documentation. `documentation/` is authoritative; do not maintain a second copy by hand.

## One-time setup

1. Enable **Wikis** in the GitHub repository settings.
2. Create the first GitHub Wiki page in the web interface if `DukkyGames/Minnow.wiki.git` does not exist yet. Its content will be replaced by the first sync.
3. Add a repository Actions secret named `WIKI_SYNC_TOKEN`. Use a fine-grained token that can write repository contents for Minnow. If the repository's `GITHUB_TOKEN` can push to the wiki, the dedicated secret may be omitted.
4. Run the **Publish GitHub Wiki** workflow manually once.

The workflow also runs after documentation changes reach `main`.

## Local preview

```bash
npm run wiki:generate
npm run wiki:stage -- --output /tmp/minnow-wiki-preview
```

Open the staging directory to inspect `_Home.md`, `_Sidebar.md`, `_Footer.md`, and flattened page names. The staging script rewrites links between published pages and sends repository-only links to GitHub source.

## Publication rules

Published:

- `documentation/README.md`
- `documentation/ROADMAP.md`
- `documentation/context.md`
- `documentation/guides/`
- `documentation/plugins/`
- `documentation/agent-packs/`
- `documentation/design-system/`

Not published:

- maintainer runbooks
- plans and specs
- archives, extracts, schemas, and templates
- agent memory
- images that are not explicitly referenced by a published page

The in-app catalog includes maintainer pages because an installed developer build may need them, but the public GitHub Wiki does not publish operational runbooks.

## Recovery

The wiki repository has normal Git history. Revert a bad publish by reverting its generated commit in `Minnow.wiki.git`, then fix the canonical documentation or staging script before running the workflow again. A later successful sync replaces generated Markdown pages but preserves the wiki repository's `.git` directory.
