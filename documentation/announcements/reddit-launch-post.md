# Reddit launch post: Minnow

Draft for r/LocalLLaMA (or similar). Adjust title/flair to the subreddit's rules before posting.

**Suggested title:** Minnow: open beta of a free, local AI workspace. I need help testing it.

**Before you post:** Use the sub's self-promo / project flair if required. A short screen recording or 2-3 real screenshots (Code + Orchestrator board) in the comments or gallery post cuts "is this real?" skepticism fast.

---

I've been working on Minnow for the last few months, mostly alone. It isn't finished. There are bugs. But some things have happened recently that convinced me it's time to get it into people's hands anyway, unfinished edges and all. This is an open beta, and I want as much feedback as I can get.

**TL;DR:** Free, AGPL workspace for local (or BYO API) models: chat, code, research, orchestration, memory. No accounts, no telemetry. Source and releases on GitHub: https://github.com/DukkyGames/Minnow

**Minnow is a free and open source AI workspace that runs on the models you already have:** LM Studio, Ollama, llama.cpp, or anything OpenAI-compatible, local or cloud. Your keys, chats, and files stay on your disk. It's AGPL-3.0-or-later. Not open core, not a free tier bolted onto a cloud product. If I ever disappeared or changed my mind, someone could fork it and keep going. That guarantee is the whole point.

**Privacy and network (checkable):**
- No Minnow account. No telemetry. No phone-home.
- Chats, config, Brain, and encrypted secrets live under `~/.minnow` on your machine.
- The tool server binds to **loopback only** until you explicitly opt into LAN access in Settings.
- Traffic to the outside world is only what **you** configure: your LLM endpoints, a web-search provider if you use Research, MCP servers, git remotes, Hugging Face downloads, and so on. Nothing else is implied.

If you want to verify before trusting me: clone the repo, `npm install && npm start`, and watch your firewall while you click around, or read the server and auth code under `server/`. I'd rather you audit than take my word for it.

**What's in it:**
- **Chat:** the daily driver, composer and sessions.
- **Code:** file tree, CodeMirror with LSP, terminal, git, chat next to your code, inline completion.
- **Research:** multi-step web research with a saved library.
- **Models:** hardware-fit scoring, Hugging Face downloads, local serving, provider routing.
- **Brain:** a markdown wiki your agents read and write, with semantic recall and a code index.
- **Issues:** issue tracking the agent files and works through itself.
- **Scheduler:** recurring agent jobs.

Underneath: 103 built-in tools in a default build (111 in tree; eight calendar/email tools stay gated with those apps), sub-agents, work agents, 15 bundled skills, MCP support, and permissions you control on every one.

**The piece I'm proudest of is Orchestrator boards.** Give it a plan and it turns that plan into a kanban board. Builder and Tester agents work through waves of tasks, each one in its own isolated git worktree so nothing steps on anything else, merging back at the end. Run it by hand, task by task, or let it go and check in later. Pair it with Super Plan (idea through interview, spec, research, and a reviewed plan before any code gets written) and it starts behaving like a small team instead of a chat box that occasionally writes files. None of it is gated. There's no "orchestration is the paid tier." That's not a thing I ever want Minnow to have.

**Local models are still rough for this.** A lot of smaller ones can't reliably drive a harness this involved yet. Tool calls fall apart, stuck in loops, context gets lost, etc. I expect that to keep improving fast, but I'd rather tell you where things stand today than oversell it.

Local models I've gotten decent results with:
- Qwen 3.6 27B
- Ornith 35B
- Qwen Coder Next 70B
- ChatGPT-OSS 120B
- Gemma 4 31B

Below that size, it's been a hard time getting reliable results. Take that as a rough floor, not a hard rule. If your setup works better at smaller sizes, I'd love to hear it.

On the cloud side, cost has kept me from testing everything as thoroughly as I'd like, but here's what's worked:
- DeepSeek V4 Flash and Pro (my recommendation if you want one answer)
- GLM family
- Kimi family
- ChatGPT API
- Claude API
- MiniMax

If you want the best results per dollar: use a bigger, stronger model for planning, and hand the actual building work to something cheaper. Planning is where model quality matters most; the build step tolerates a weaker model far better once the plan is solid. I've had good luck with the Opencode Go subscription as a cost-effective API plan with Minnow. **No affiliation**, just sharing what I pay for.

**I need your help.** Minnow works, but it's a big project and it has its fair share of bugs. If you try it and something breaks, a bug report is genuinely the most useful thing you can give me right now. Feedback and reports are the best way to help!

**Links:**
- **Repo:** https://github.com/DukkyGames/Minnow
- **License (AGPL-3.0-or-later):** https://github.com/DukkyGames/Minnow/blob/main/LICENSE
- **Releases / installer:** https://github.com/DukkyGames/Minnow/releases
- **Setup:** https://github.com/DukkyGames/Minnow/blob/main/documentation/guides/setup.md
- **Discord:** https://discord.gg/U4FPzv9K4X

Open weights got us here. I'd like to help make sure they're what gets us the rest of the way, too.

**Full disclosure:** LLMs were involved in almost every stage of building Minnow, but I wouldn't call it vibe coding. Stuff was iterated on, reviewed, and tested to the best of my abilities. The rough edges are still on me.

Your feedback is greatly appreciated.
