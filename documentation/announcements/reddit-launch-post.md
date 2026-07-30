# Reddit launch post — Minnow

Draft for r/LocalLLaMA (or similar). Adjust title/flair to the subreddit's rules before posting.

**Suggested title:** Minnow — a free, open source AI workspace built on the belief that open weights should stay open (Chat, Code, Orchestration, and more, all local)

---

I want to talk about why we built Minnow, and it starts with something a little bigger than the app itself.

Open weight models are one of the best things that has happened to this field. Someone trains a model, hands it to the world with no strings attached, and suddenly a kid with a 3090, a researcher with no budget, and a company that doesn't want their data leaving the building can all build the same kinds of things the labs with the big checkbooks build. That's not a small thing. That's the whole promise of this technology staying in reach of the people actually using it, instead of becoming something you rent forever from three companies.

And it's under pressure. Not from any one dramatic villain, but from a slow, steady push — "safety" framing that conveniently always lands on "so send us your data instead," licensing that gets a little less open with every release, API-only launches for models that used to ship weights, lobbying to raise the floor on what counts as "safe to release" until only the incumbents can clear it. None of this is conspiracy-brained. It's just what happens when open weights start actually threatening someone's subscription business. Openness doesn't get taken away with an announcement. It gets taken away one quiet decision at a time, and you don't notice until the option is gone.

We think the answer to that isn't a manifesto, it's tools. Make the local, open path so genuinely good to use that closing it off stops being a viable business strategy. That's what Minnow is for.

**Minnow is a free and open source AI workspace that runs on the models you already have** — LM Studio, Ollama, llama.cpp, or anything speaking the OpenAI-compatible API. Your keys, chats, files, and models stay on your disk. Nothing phones home, because there's no home for it to phone.

It's AGPL-3.0-or-later. Not "open core." Not a free tier bolted onto a cloud product. Everything, forever, for anyone. If that ever stopped being true, someone could fork it and keep going — that's the actual guarantee open licenses give you, and it's the whole point.

**What's actually in it:**

- **Chat** — the daily driver. Composer, sessions, notifications, nothing you have to fight.
- **Code** — a real build workspace: file tree, CodeMirror with LSP, terminal, git, chat sitting right next to your code, inline completion.
- **Research** — multi-step web research with a library that keeps what it finds.
- **Models** — hardware-fit scoring so you know what your machine can actually run, Hugging Face downloads, local serving, provider routing.
- **Brain** — a markdown wiki your agents read and write to, with semantic recall and a code index, so context survives past one chat window.
- **Issues** — issue tracking the agent can file and work through on its own.
- **Scheduler** — recurring agent jobs, so things run without you babysitting them.

Underneath all of that: 111 built-in tools, sub-agents, work agents, 15 bundled skills, MCP support, and permissions on every one of them that you control.

**The part I'm most excited about is Orchestrator boards.** You hand it a plan, and it turns that plan into a kanban board — Builder and Tester agents working waves of tasks, each one in its own isolated git worktree so nothing steps on anything else, merging back together at the end. You can drive it by hand, task by task, or let it run and check in when it's done. Pair that with Super Plan, which walks an idea from a rough interview through spec, research, and a reviewed plan before a single line of code gets written, and you've got something that actually behaves like a small team instead of a chat window that occasionally writes files.

None of this is locked behind a tier. There's no "orchestration is a Pro feature." It ships because that's what a complete workspace means.

**Everything is meant to be taken apart.** Skills are just `SKILL.md` files you drop in a folder. Tools are local plugins, no MCP server required, or point it at any MCP server you already run. Every system prompt in the app is a markdown file you can edit. Themes are tokens in one file. And because it's AGPL, the whole thing is a fork away from being yours if you ever want it to be.

We're not pretending this is charity. It's built and funded by the people who use it, the way Blender is — no accounts, no subscriptions, no usage gates, and a sponsor link for anyone who wants to help keep it that way. That's the model we're betting on: open, useful enough that people choose to fund it, and impossible to quietly close off later because the license won't let it happen.

If you've got a model loaded in LM Studio or Ollama right now, this is a `git clone` and an `npm install` away:

```
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
npm start
```

Repo: https://github.com/DukkyGames/Minnow
Discord: https://discord.gg/U4FPzv9K4X

Open weights got us here. We'd like to help keep it that way. Would genuinely love to hear what you build with it, and what you think is missing.
