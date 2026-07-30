# Minnow wiki

Minnow ships official product and developer documentation inside the app. Open it from the **?** button in the menubar or navigate to `#/wiki`.

## Find help

- Browse pages by section in the left navigation.
- Search titles, headings, paths, summaries, and page text from the top search field.
- Press **Ctrl+K** or **Cmd+K** while the wiki is open to focus search.
- Copy a deep link from the address bar. The selected page reopens after reload.
- Follow documentation links inside the reader. Links to source code or external sites open on GitHub or the original website.

The wiki is read-only because its pages describe the installed Minnow version. Changes belong in the repository's `documentation/` folder.

## Ask chat about Minnow

Desktop chat, General mode, and the onboarding guide can use three read-only tools:

| Tool | Purpose |
|---|---|
| `minnow_docs_search` | Find official pages and citation-ready excerpts. |
| `minnow_docs_read` | Read a page returned by search. |
| `minnow_docs_list` | Browse the official catalog by path. |

For questions about Minnow setup, apps, modes, tools, settings, architecture, or roadmap, chat searches the official wiki before using personal Brain notes. Answers can cite the `documentation/...` source path returned by the tools.

## Official wiki and Brain are different

| Surface | Content | Writable | Storage |
|---|---|---|---|
| Minnow wiki | Versioned product and developer help | No, at runtime | Installed `documentation/` |
| Brain | Your facts, decisions, project context, and code knowledge | Yes | `~/.minnow/brain/` |
| GitHub Wiki | Public mirror of the official wiki | Generated from the repository | GitHub |

Use the official wiki to learn Minnow. Use Brain to preserve knowledge that belongs to you or your project.

## Contribute documentation

1. Edit or add Markdown under `documentation/`.
2. Add the page to `documentation/README.md` when it is a primary entry point.
3. Run `npm run wiki:generate`.
4. Run the documentation and build checks.
5. Merge the change to `main`; the wiki workflow publishes the public mirror.

Engineering plans, archives, generated schemas, and agent memory are intentionally excluded from the product wiki.
