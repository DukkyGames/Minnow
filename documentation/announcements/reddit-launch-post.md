# Reddit launch post — Minnow

Draft for r/LocalLLaMA (or similar). Adjust title/flair to the subreddit's rules before posting.

**Suggested title:** Minnow — an open beta of a free, local AI workspace. I need your help testing it.

---

I've been working on Minnow for the last few months, mostly alone. It isn't finished. There are bugs. But some things have happened recently that convinced me it's time to get it into people's hands anyway, unfinished edges and all. This is an open beta, and I want as much feedback as I can get.

Here's why now.

DeepSeek, GLM, and Kimi have shown that open models can go toe to toe with the frontier labs. That's not a small thing — it means the gap that used to make "just use the API" the only serious option is closing. Put those models behind a real harness — planning, orchestration, tools, memory — and you start threatening the thing OpenAI's and Anthropic's businesses actually depend on. And when something threatens a business, that business fights back. Not always loudly. Sometimes it's licensing that gets a little less open with each release, or "safety" arguments that always seem to land on "so send us your data instead," or lobbying to raise the bar on what counts as releasable until only the incumbents can clear it. I think they're going to actively try to take this away from us, and I don't think it'll look like a headline when it happens. It'll look like a dozen quiet decisions, and one day the option just isn't there anymore.

AI is going to change the world. That part isn't in question anymore. What's still in question is who it changes the world for — everyone, or a small number of companies and the people who own them. Right now the direction we're heading points toward the second one. I don't think that's inevitable, but I don't think it fixes itself either. It gets fixed by people building and using the open alternative until closing it off stops making business sense.

That's what Minnow is my attempt at.

**Minnow is a free and open source AI workspace that runs on the models you already have** — LM Studio, Ollama, llama.cpp, or anything OpenAI-compatible, local or cloud. Your keys, chats, and files stay on your disk. It's AGPL-3.0-or-later — not open core, not a free tier bolted onto a cloud product. If I ever disappeared or changed my mind, someone could fork it and keep going. That guarantee is the whole point.

**What's in it:**
- **Chat** — the daily driver, composer and sessions.
- **Code** — file tree, CodeMirror with LSP, terminal, git, chat next to your code, inline completion.
- **Research** — multi-step web research with a saved library.
- **Models** — hardware-fit scoring, Hugging Face downloads, local serving, provider routing.
- **Brain** — a markdown wiki your agents read and write, with semantic recall and a code index.
- **Issues** — issue tracking the agent files and works through itself.
- **Scheduler** — recurring agent jobs.

Underneath: 111 built-in tools, sub-agents, work agents, 15 bundled skills, MCP support, and permissions you control on every one.

**The piece I'm proudest of is Orchestrator boards.** Give it a plan and it turns that plan into a kanban board — Builder and Tester agents working through waves of tasks, each one in its own isolated git worktree so nothing steps on anything else, merging back at the end. Run it by hand, task by task, or let it go and check in later. Pair it with Super Plan, which takes an idea through interview, spec, research, and a reviewed plan before any code gets written, and it starts behaving like a small team instead of a chat box that occasionally writes files. None of it is gated. There's no "orchestration is the paid tier" — that's not a thing I ever want Minnow to have.

**Honestly: local models are still rough for this.** A lot of smaller ones can't reliably drive a harness this involved yet — tool calls fall apart, planning breaks down, context gets lost. I expect that to keep improving fast, but I'd rather tell you the truth about where things stand today than oversell it.

Local models I've gotten decent results with:
- Qwen 3.6 27B
- Ornith 35B
- Qwen Coder Next 70B
- ChatGPT-OSS 120B
- Gemma 4 31B

Below that size, it's been a genuinely hard time getting reliable results — take that as a rough floor, not a hard rule.

On the cloud side, cost has kept me from testing everything as thoroughly as I'd like, but here's what's worked:
- DeepSeek V4 Flash and Pro (my recommendation if you want one answer)
- GLM family
- Kimi family
- ChatGPT API
- Claude API
- MiniMax

If you want the best results per dollar: use a bigger, stronger model for planning, and hand the actual building work to something cheaper. The planning step is where model quality matters most; the build step tolerates a weaker model far better once the plan is solid.

**I need your help.** Minnow works, but it's one person's project and it has its fair share of bugs. If you try it and something breaks, a bug report is genuinely the most useful thing you can give me right now — feedback and reports are the best way to help even if you never touch the code. If you want to help build it, come find me on Discord.

```
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
npm start
```

Repo: https://github.com/DukkyGames/Minnow · Discord: https://discord.gg/U4FPzv9K4X

Open weights got us here. I'd like to help make sure they're what gets us the rest of the way, too. Tell me what breaks.
