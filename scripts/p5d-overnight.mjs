import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  compareToBaseline,
  reportCount,
  startSampler,
  takeSample,
} from '../server/orchestrator/p5d-instrument.js';

const HOUR_MS = 3_600_000;

// ── CLI args ─────────────────────────────────────────────────────────────────

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean | string[]>} */
  const out = { induce: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === 'induce') {
      if (next) out.induce.push(next);
      i += 1;
    } else if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

// ── Induction ────────────────────────────────────────────────────────────────

/**
 * @param {string} spec
 */
export function parseInduction(spec) {
  const match = /^([a-z-]+)@(\d+(?:\.\d+)?)(h|m|s)$/.exec(String(spec).trim());
  if (!match) throw new Error(`bad --induce spec: ${spec} (expected kind@2h)`);
  const [, kind, amount, unit] = match;
  const KNOWN = new Set(['kill-server', 'revoke-key', 'break-task']);
  if (!KNOWN.has(kind)) {
    throw new Error(`unknown induction "${kind}" (known: ${[...KNOWN].join(', ')})`);
  }
  const scale = unit === 'h' ? HOUR_MS : unit === 'm' ? 60_000 : 1_000;
  return { kind, atMs: Number(amount) * scale };
}

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * @param {{
 */
export function renderRunReport(input) {
  const last = input.samples[input.samples.length - 1] ?? {};
  const first = input.samples[0] ?? {};
  const hours = ((input.endedAt - input.startedAt) / HOUR_MS).toFixed(2);
  const tasks = Object.values(input.state?.tasks ?? {});
  const done = tasks.filter((t) => t?.status === 'done');
  const abandoned = tasks.filter((t) => t?.status === 'abandoned');
  const unfinished = tasks.filter(
    (t) => t?.status !== 'done' && t?.status !== 'abandoned',
  );

  const lines = [];
  lines.push(`# P5-D unattended run — ${input.boardId}`, '');
  lines.push(
    `**${hours}h**, concurrency ${input.state?.concurrency ?? '?'}, ` +
      `${input.samples.length} samples.`,
    '',
  );

  lines.push('## What shipped', '');
  if (done.length === 0) lines.push('Nothing merged.', '');
  else {
    for (const task of done) lines.push(`- ${task.id} — ${task.title ?? ''}`.trimEnd());
    lines.push('');
  }

  lines.push('## What did not ship', '');
  if (abandoned.length === 0 && unfinished.length === 0) {
    lines.push('Everything in the plan completed.', '');
  } else {
    for (const task of abandoned) {
      lines.push(`- **${task.id} — abandoned.** ${task.abandonReason ?? 'no reason recorded'}`);
    }
    for (const task of unfinished) {
      lines.push(`- ${task.id} — left ${task.status ?? 'unknown'}.`);
    }
    lines.push('');
  }

  lines.push('## What to do next', '');
  if (abandoned.length > 0) {
    lines.push(
      'Read the abandoned tasks above first. Each one blocked its genuine',
      'dependents; everything else finished around it.',
      '',
    );
  } else if (unfinished.length > 0) {
    lines.push('The run ended with tasks still open — check the ceiling and the log below.', '');
  } else {
    lines.push('Nothing. Review the merged work and close the board.', '');
  }

  lines.push('## Did it need anyone', '');
  const report = last.report ?? {};
  lines.push(
    `- Reports written: **${report.reports ?? 0}** ` +
      `(${report.exactlyOnce ? 'exactly once — as required' : 'NOT exactly once'})`,
  );
  lines.push(`- Open attempts at the end: ${(last.attempts?.open ?? []).length}`);
  lines.push(`- Browser processes left: ${last.census?.browsers ?? 'unsampled'}`);
  lines.push(`- Stale worktrees left: ${(last.worktrees?.stale ?? []).length}`);
  lines.push('');

  lines.push('## The long-run numbers', '');
  lines.push('| Metric | Start | End |');
  lines.push('|---|---|---|');
  lines.push(`| Journal bytes | ${first.journal?.bytes ?? '?'} | ${last.journal?.bytes ?? '?'} |`);
  lines.push(`| Journal events | ${first.journal?.events ?? '?'} | ${last.journal?.events ?? '?'} |`);
  lines.push(
    `| Fold duration (ms) | ${fmt(first.fold?.ms)} | ${fmt(last.fold?.ms)} |`,
  );
  lines.push(`| RSS (MB) | ${mb(first.census?.rss)} | ${mb(last.census?.rss)} |`);
  lines.push('');
  lines.push(
    'Fold duration is the one to read closely. It is what P0-G’s snapshot',
    'exists to keep flat, and this is the first time it is measured at real',
    'scale. If it tracks the journal rather than staying flat, the snapshot is',
    'not doing its job.',
    '',
  );

  lines.push('## Attempts', '');
  const attempts = last.attempts ?? {};
  lines.push(
    `${attempts.count ?? 0} finished. ` +
      `median ${fmt(attempts.median)}ms, p90 ${fmt(attempts.p90)}ms, max ${fmt(attempts.max)}ms.`,
    '',
    'The tail is the number that matters: one attempt that took an hour because',
    'a provider was throttling is what turns a six-hour run into a twelve-hour',
    'one, and it vanishes into a mean.',
    '',
  );

  lines.push('## Cost', '');
  const cost = last.cost ?? {};
  if (!cost.complete) {
    lines.push(
      `**Incomplete.** ${cost.attemptsWithoutUsage ?? '?'} attempts reported no usage, ` +
        `${cost.attemptsWithUsage ?? 0} did. The total below is a floor, not the cost.`,
      '',
    );
  }
  lines.push(`- Total tokens: ${cost.total_tokens ?? 0}`);
  lines.push(`- Prompt / completion: ${cost.prompt_tokens ?? 0} / ${cost.completion_tokens ?? 0}`);
  lines.push(`- Spent on attempts that produced nothing: ${cost.wasted?.total_tokens ?? 0}`);
  lines.push('');
  lines.push(
    'Check this against the reference point the project set for itself: +60%',
    'cost for +3.2% correctness is the trade that made the multi-agent case',
    'doubtful. A run that cannot state its cost cannot answer that.',
    '',
  );

  if (input.comparisons?.length) {
    lines.push('## Against the earlier baselines', '');
    for (const c of input.comparisons) {
      lines.push(`### ${c.label}`, '');
      if (!c.comparable) {
        lines.push('Not comparable: ' + (c.notes ?? []).join('; '), '');
        continue;
      }
      lines.push(`_${c.caveat}_`, '');
      for (const [key, d] of Object.entries(c.delta ?? {})) {
        lines.push(`- ${key}: baseline ${fmt(d.baseline)} → observed ${fmt(d.observed)}`);
      }
      if (c.notes?.length) lines.push('', ...c.notes.map((n) => `- ⚠ ${n}`));
      lines.push('');
    }
  }

  lines.push('## Induced failures', '');
  if (input.inductions.length === 0) {
    lines.push(
      'None. Recovery is part of the proof, not a separate test — a run with no',
      'induced failure has not shown it survives one.',
      '',
    );
  } else {
    for (const induction of input.inductions) {
      lines.push(
        `- ${induction.kind} at +${(induction.atMs / HOUR_MS).toFixed(2)}h — ` +
          (induction.firedAt ? 'fired' : '**never fired**'),
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return '?';
  return Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1);
}

function mb(bytes) {
  if (!Number.isFinite(Number(bytes))) return '?';
  return (Number(bytes) / 1024 / 1024).toFixed(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const boardId = String(args.board ?? `p5d-${new Date().toISOString().slice(0, 10)}`);
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const planPath = String(
    args.plan ?? path.join(repoRoot, 'test', 'fixtures', 'orchestrator-v2-p5d', 'plan.md'),
  );
  const concurrency = Number(args.concurrency ?? 2);
  const sampleMs = Number(args['sample-ms'] ?? 60_000);
  const maxHours = Number(args['max-hours'] ?? 14);
  const outDir = String(
    args.out ?? path.join(repoRoot, 'documentation', 'plans', 'p5d-runs', boardId),
  );
  const inductions = (args.induce ?? []).map(parseInduction);

  await fsp.mkdir(outDir, { recursive: true });

  const journal = await import('../server/orchestrator/journal.js');
  const engineModule = await import('../server/orchestrator/engine.js');

  const startedAt = Date.now();
  const exists = await journal.boardExists(boardId);
  if (exists && !args.resume) {
    throw new Error(
      `board ${boardId} already exists. Pass --resume to attach to it, or choose another --board.`,
    );
  }
  if (!exists) {
    await journal.createBoard(boardId);
    const planMarkdown = await fsp.readFile(planPath, 'utf8');
    const { parsePlan, isParseErrors } = await import('../server/orchestrator/core/parse-plan.js');
    const parsed = parsePlan(planMarkdown);
    if (isParseErrors(parsed)) {
      throw new Error(`plan does not parse: ${JSON.stringify(parsed)}`);
    }
    console.log(`[p5d] created ${boardId}: ${parsed.tasks.length} tasks, ${parsed.waves.length} waves`);
  } else {
    console.log(`[p5d] resuming ${boardId} — recovery from the journal is part of the proof`);
  }

  const sampler = startSampler({
    boardId,
    worktreeRoot: path.join(repoRoot, '.minnow', 'worktrees', boardId),
    intervalMs: sampleMs,
    onSample: (sample) => {
      console.log(
        `[p5d] +${((sample.elapsedMs ?? 0) / 60_000).toFixed(1)}m ` +
          `events=${sample.journal?.events ?? '?'} ` +
          `fold=${fmt(sample.fold?.ms)}ms rss=${mb(sample.census?.rss)}MB ` +
          `browsers=${sample.census?.browsers ?? '?'}`,
      );
    },
  });

  /** @type {NodeJS.Timeout[]} */
  const timers = [];
  for (const induction of inductions) {
    const timer = setTimeout(async () => {
      induction.firedAt = Date.now();
      console.log(`[p5d] inducing ${induction.kind}`);
      if (induction.kind === 'kill-server') {
        await sampler.stop();
        await writeRecord();
        process.exit(9);
      } else if (induction.kind === 'revoke-key') {
        process.env.MINNOW_P5D_REVOKED = '1';
        console.log('[p5d] provider key marked revoked for this process');
      } else if (induction.kind === 'break-task') {
        const target = path.join(outDir, 'induced-break.mjs');
        await fsp.writeFile(target, 'this is not valid javascript ===\n', 'utf8');
        console.log(`[p5d] wrote a broken file at ${target}`);
      }
    }, induction.atMs);
    timers.push(timer);
  }

  const writeRecord = async () => {
    const endedAt = Date.now();
    const samples = sampler.samples;
    let state = null;
    try {
      state = await journal.loadState(boardId);
    } catch {
      state = null;
    }
    const events = await journal.readEvents(boardId).catch(() => []);
    const counts = reportCount(events);
    const run = {
      merged: events.filter((e) => e?.type === 'merge.succeeded').length,
      retries: events.filter(
        (e) => e?.type === 'task.attempt.started' && e.seedKind && e.seedKind !== 'initial',
      ).length,
      abandonments: events.filter((e) => e?.type === 'task.abandoned').length,
      ms: endedAt - startedAt,
    };
    /** @type {Array<Record<string, unknown>>} */
    const comparisons = [];
    for (const [label, file] of [
      ['P2-G (N=1)', 'p2g-reliability.json'],
      ['P3-E (N=2)', 'p3e-reliability.json'],
    ]) {
      try {
        const raw = JSON.parse(
          await fsp.readFile(path.join(repoRoot, 'test', 'orchestrator', file), 'utf8'),
        );
        comparisons.push(compareToBaseline(run, { label, perRun: raw.perRun }));
      } catch (err) {
        comparisons.push({ label, comparable: false, notes: [String(err)] });
      }
    }

    const record = { boardId, planPath, concurrency, startedAt, endedAt, run, counts, inductions, samples };
    await fsp.writeFile(
      path.join(outDir, 'record.json'),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(outDir, 'report.md'),
      renderRunReport({ boardId, startedAt, endedAt, samples, inductions, state, comparisons }),
      'utf8',
    );
    console.log(`[p5d] wrote ${path.join(outDir, 'report.md')}`);
  };

  const ceiling = setTimeout(async () => {
    console.log(`[p5d] hit the ${maxHours}h ceiling`);
    await sampler.stop();
    await writeRecord();
    process.exit(3);
  }, maxHours * HOUR_MS);

  const finish = async (code) => {
    clearTimeout(ceiling);
    for (const timer of timers) clearTimeout(timer);
    await sampler.stop();
    await writeRecord();
    process.exit(code);
  };

  process.on('SIGINT', () => void finish(130));
  process.on('SIGTERM', () => void finish(143));

  for (;;) {
    await new Promise((r) => setTimeout(r, Math.min(sampleMs, 30_000)));
    const events = await journal.readEvents(boardId).catch(() => []);
    if (reportCount(events).reports >= 1) {
      console.log('[p5d] the run reported — finishing');
      await finish(0);
      return;
    }
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[p5d]', err);
    process.exit(1);
  });
}
