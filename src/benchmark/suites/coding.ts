/**
 * Coding suite: runnable JavaScript (executed via run_javascript) + text/judge cases.
 */

import { assertNotAborted, rethrowIfAborted } from '../abort.ts';
import { computeSuiteResultStats } from '../scoring.ts';
import {
  CODING_JAVASCRIPT_PROMPT_SUFFIX,
  fizzBuzzLinePasses,
  jsonStdoutPasses,
} from '../coding-code.ts';
import { codingRunDetails, runCodingJavaScriptFromModelText } from '../coding-run.ts';
import { runOneShot } from '../llm-driver.ts';
import { exactMatch, parseJudgeJson } from '../scoring.ts';
import { announceTestStart, buildTestResult, reportTest } from '../test-result.ts';
import type { BenchmarkRunContext, SuiteResult, TestResult } from '../types.ts';

type CodingCase =
  | {
      kind: 'javascript';
      id: string;
      label: string;
      task: string;
      verifyStdout: (stdout: string) => boolean;
    }
  | {
      kind: 'text';
      id: string;
      label: string;
      prompt: string;
      score: (text: string) => boolean;
    }
  | {
      kind: 'judge';
      id: string;
      label: string;
      prompt: string;
    };

const CASES: CodingCase[] = [
  {
    kind: 'javascript',
    id: 'code-fizzbuzz',
    label: 'FizzBuzz line',
    task:
      'Print the FizzBuzz sequence from 1 to 15 as one comma-separated line (numbers and Fizz/Buzz/FizzBuzz words only).',
    verifyStdout: (stdout) => fizzBuzzLinePasses(stdout),
  },
  {
    kind: 'javascript',
    id: 'code-reverse',
    label: 'Reverse string',
    task: 'Reverse the string "minnow" and print only the reversed text.',
    verifyStdout: (stdout) => exactMatch(stdout, 'wonnim'),
  },
  {
    kind: 'javascript',
    id: 'code-fib',
    label: 'Fibonacci(10)',
    task:
      'Print the 10th Fibonacci number (0-indexed: F(0)=0, F(1)=1) as a single integer.',
    verifyStdout: (stdout) => /^\s*55\s*$/.test(stdout.trim()) || /\b55\b/.test(stdout),
  },
  {
    kind: 'javascript',
    id: 'code-json',
    label: 'JSON transform',
    task:
      'Given the object {"a":1,"b":2}, print JSON with keys swapped to {"b":2,"a":1} (JSON only on stdout).',
    verifyStdout: (stdout) => jsonStdoutPasses(stdout),
  },
  {
    kind: 'javascript',
    id: 'code-regex',
    label: 'Regex extract',
    task:
      'Extract the first email from: contact us at team@minnow.dev today. Print the email only.',
    verifyStdout: (stdout) => /team@minnow\.dev/.test(stdout.trim()),
  },
  {
    kind: 'text',
    id: 'code-sql',
    label: 'SQL hint',
    prompt: 'Write a SQL query to select names from users where active = true. SQL only.',
    score: (t) => /select/i.test(t) && /users/i.test(t),
  },
  {
    kind: 'javascript',
    id: 'code-bug',
    label: 'Spot bug',
    task:
      'Fix function add(a,b){ return a-b } so add(2,3) is 5. Define the fixed function and console.log(add(2,3)).',
    verifyStdout: (stdout) => stdout.trim() === '5',
  },
  {
    kind: 'text',
    id: 'code-type',
    label: 'Type signature',
    prompt: 'TypeScript: function identity<T>(x: T): T. What does T mean? One sentence.',
    score: (t) => /generic|type parameter|placeholder/i.test(t),
  },
  {
    kind: 'judge',
    id: 'code-judge-explain',
    label: 'Explain (judged)',
    prompt: 'Explain recursion in programming in two sentences.',
  },
  {
    kind: 'judge',
    id: 'code-judge-refactor',
    label: 'Refactor (judged)',
    prompt: 'Suggest one improvement for: const x = arr.map(i=>i*2).filter(i=>i>4)',
  },
];

function promptForCase(c: CodingCase): string {
  if (c.kind === 'javascript') {
    return c.task + CODING_JAVASCRIPT_PROMPT_SUFFIX;
  }
  return c.prompt;
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

async function evaluateCase(
  ctx: BenchmarkRunContext,
  c: CodingCase,
  modelText: string,
): Promise<{ passed: boolean; details: string; judged: boolean; judgeRaw?: string }> {
  if (c.kind === 'text') {
    const passed = c.score(modelText);
    return {
      passed,
      details: modelText.slice(0, 120),
      judged: false,
    };
  }

  if (c.kind === 'judge') {
    const verdict = await runJudge(ctx, c.prompt, modelText);
    return {
      passed: verdict.pass,
      details: verdict.reason,
      judged: true,
      judgeRaw: verdict.raw,
    };
  }

  const run = await runCodingJavaScriptFromModelText(modelText, ctx.signal);
  if (run.ok === false) {
    return {
      passed: false,
      details: run.reason,
      judged: false,
    };
  }

  const passed = c.verifyStdout(run.result.stdout);
  return {
    passed,
    details: codingRunDetails(modelText, run.result, passed),
    judged: false,
  };
}

export async function runCodingSuite(ctx: BenchmarkRunContext): Promise<SuiteResult> {
  const tests: TestResult[] = [];

  for (const c of CASES) {
    assertNotAborted(ctx.signal);
    const t0 = performance.now();
    const testId = c.id;
    const label = c.label;
    announceTestStart(ctx, {
      testId,
      suite: 'coding',
      label,
    });

    if (c.kind === 'javascript' && !ctx.localServer) {
      reportTest(ctx, tests, {
        testId,
        suite: 'coding',
        label,
        passed: false,
        skipped: true,
        skipReason: 'needs npm start',
        durationMs: performance.now() - t0,
        score: 0,
        details: 'JavaScript probes require the tool server (npm start)',
      });
      continue;
    }

    try {
      const prompt = promptForCase(c);
      const out = await runOneShot({
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        signal: ctx.signal,
        messages: [{ role: 'user', content: prompt }],
      });

      const evaluation = await evaluateCase(ctx, c, out.text);

      reportTest(ctx, tests,
        buildTestResult(
          {
            testId,
            suite: 'coding',
            label,
            passed: evaluation.passed,
            skipped: false,
            judged: evaluation.judged,
            durationMs: performance.now() - t0,
            score: evaluation.passed ? 1 : 0,
            details: evaluation.details,
          },
          out,
          evaluation.judgeRaw ? { judgeRaw: evaluation.judgeRaw } : undefined,
        ),
      );
    } catch (err) {
      rethrowIfAborted(err, ctx.signal);
      reportTest(ctx, tests,
        buildTestResult(
          {
            testId,
            suite: 'coding',
            label,
            passed: false,
            skipped: false,
            judged: c.kind === 'judge',
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

  const stats = computeSuiteResultStats(tests);

  return {
    id: 'coding',
    label: 'Coding',
    ...stats,
    tests,
  };
}
