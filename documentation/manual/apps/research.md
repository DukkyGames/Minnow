# Research app

Use **Research** when you need a structured, multi-step investigation on the web rather than a single quick answer in chat.

## Open Research

Click **Research** in the dock. The desktop layout keeps chat context while Research runs its workflow.

## Run a research job

1. Enter a **topic** or question in the Research UI.
2. Watch the **progress stepper** while a sub-agent gathers and synthesizes sources.
3. Read the finished report in the Research surface.

Fetched page text is fenced as untrusted data before it reaches the model, so instructions embedded in a web page are not followed as commands.

## Library

Saved reports live in the **Library** (floating window).

| Action | Purpose |
|--------|---------|
| **Save** from a finished run | Keep the report for later |
| **Re-open** | Read without re-running the whole job |
| **Discuss** | Continue in chat with the report as context |

Use the library when you compare vendors, survey APIs, or collect citations over days.

## Tips

- Pick a capable model in the menubar or composer before long runs.
- Set your search provider under **Settings → Tools & integrations → Search**. The default is **SearXNG** against a local instance; **DuckDuckGo** needs no key, and **Brave** / **Tavily** need API keys. A fallback chain covers the primary provider failing.
- For login-heavy sites, browser automation tools require the **Electron** desktop app, not a plain external browser tab.

## Related

- [Settings app](settings.md) — Search and Deep Research sections
- [Troubleshooting](../reference/troubleshooting.md)
