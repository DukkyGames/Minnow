/**
 * Coding suite: deterministic outputs + inline LLM judge cases.
 */

import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { exactMatch, parseJudgeJson } from '../scoring.ts';
import { runOneShot } from '../llm-driver.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';

interface CodingCase {
  id: string;
  label: string;
  prompt: string;
  judge?: boolean;
  score: (text: string) => boolean;
}

const CASES: CodingCase[] = [
  {
    id: 'code-fizzbuzz',
    label: 'FizzBuzz line',
    prompt: 'Print the FizzBuzz sequence from 1 to 15 as one comma-separated line. Numbers only and Fizz/Buzz words.',
    score: (t) => /1,.*15/.test(t) && /Fizz/.test(t),
  },
  {
    id: 'code-reverse',
    label: 'Reverse string',
    prompt: 'Reverse the string "minnow" and reply with only the reversed text.',
    score: (t) => exactMatch(t, 'wonnim'),
  },
  {
    id: 'code-fib',
    label: 'Fibonacci(10)',
    prompt: 'What is the 10th Fibonacci number (0-indexed F(0)=0,F(1)=1)? Reply with the integer only.',
    score: (t) => /\b55\b/.test(t),
  },
  {
    id: 'code-json',
    label: 'JSON transform',
    prompt: 'Given {"a":1,"b":2} return JSON with keys swapped to {"b":2,"a":1}. JSON only.',
    score: (t) => jsonShapeMatch(t) && t.includes('"b"') && t.includes('"a"'),
  },
  {
    id: 'code-regex',
    label: 'Regex extract',
    prompt: 'Extract the first email from: contact us at team@minnow.dev today. Reply with the email only.',
    score: (t) => /team@minnow\.dev/.test(t),
  },
  {
    id: 'code-sql',
    label: 'SQL hint',
    prompt: 'Write a SQL query to select names from users where active = true. SQL only.',
    score: (t) => /select/i.test(t) && /users/i.test(t),
  },
  {
    id: 'code-bug',
    label: 'Spot bug',
    prompt: 'Fix: function add(a,b){ return a-b }. Reply with the fixed function only.',
    score: (t) => /return\s+a\s*\+\s*b/.test(t.replace(/\s/g, '')),
  },
  {
    id: 'code-type',
    label: 'Type signature',
    prompt: 'TypeScript: function identity<T>(x: T): T. What does T mean? One sentence.',
    score: (t) => /generic|type parameter|placeholder/i.test(t),
  },
  {
    id: 'code-judge-explain',
    label: 'Explain (judged)',
    judge: true,
    prompt: 'Explain recursion in programming in two sentences.',
    score: () => true,
  },
  {
    id: 'code-judge-refactor',
    label: 'Refactor (judged)',
    judge: true,
    prompt: 'Suggest one improvement for: const x = arr.map(i=>i*2).filter(i=>i>4)',
    score: () => true,
  },
];

function jsonShapeMatch(text: string): boolean {
  try {
    JSON.parse(text.trim());
    return true;
  } catch {
    return /\{[\s\S]*\}/.test(text);
  }
}

async function runJudge(
  ctx: BenchmarkRunContext,
  task: string,
  answer: string,
): Promise<{ pass: boolean; reason: string; raw: string }> {
  const out = await runOneShot({
    providerId: ctx.providerId,
    modelId: ctx.modelId,
    signal: ctx.signal,
    messages: [
      {
        role: 'system',
        content:
          'You grade benchmark answers. Output JSON only: {"pass":boolean,"reason":string}.',
      },
      {
        role: 'user',
        content: `Task: ${task}\nAnswer: ${answer}\nGrade whether the answer satisfies the task.`,
      },
    ],
  });
  const verdict = parseJudgeJson(out.text);
  return { ...verdict, raw: out.text };
}

export async function runCodingSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];

  for (const c of CASES) {
    assertNotAborted(ctx.signal);
    const t0 = performance.now();
    announceTestStart(ctx, {
      testId: c.id,
      suite: 'coding',
      label: c.label,
    });
    try {
      const out = await runOneShot({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [{ role: 'user', content: c.prompt }],
      });

      let passed = c.score(out.text);
      let details = out.text.slice(0, 120);
      let judgeRaw: string | undefined;
      if (c.judge) {
        const verdict = await runJudge(ctx, c.prompt, out.text);
        passed = verdict.pass;
        details = verdict.reason;
        judgeRaw = verdict.raw;
      }

      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: c.id,
            suite: 'coding',
            label: c.label,
            passed,
            skipped: false,
            judged: Boolean(c.judge),
            durationMs: performance.now() - t0,
            score: passed ? 1 : 0,
            details,
          },
          out,
          judgeRaw ? { judgeRaw } : undefined,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId: c.id,
            suite: 'coding',
            label: c.label,
            passed: false,
            skipped: false,
            judged: Boolean(c.judge),
            durationMs: performance.now() - t0,
            score: 0,
            details: err instanceof Error ? err.message : String(err),
          },
          null,
          { error: err instanceof Error ? err.message : String(err) },
        ),
      );
    }
  }

  const passed = tests.filter((t) => t.passed).length;
  return {
    id: 'coding',
    label: 'Coding',
    passed,
    failed: tests.length - passed,
    skipped: 0,
    score: tests.length ? passed / tests.length : 0,
    tests,
  };
}
