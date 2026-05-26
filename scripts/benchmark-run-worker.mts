#!/usr/bin/env node
/**
 * Runs a benchmark in a child process (survives browser reload).
 * Config JSON path is argv[2]; progress events are emitted as NDJSON on stdout.
 */

import fs from 'node:fs/promises';
import { runBenchmark } from '../src/benchmark/runner.ts';
import { setLocalServerAvailable } from '../src/tools/config.ts';
import type { BenchmarkProgressEvent } from '../src/benchmark/types.ts';
import type { ProviderPublic } from '../src/providers/types.ts';

interface WorkerConfig {
  baseUrl: string;
  preset: import('../src/benchmark/types.ts').BenchmarkPreset;
  suites: import('../src/benchmark/types.ts').SuiteId[];
  providerId: string;
  modelId: string;
  provider: ProviderPublic;
}

function emit(event: BenchmarkProgressEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function patchFetch(baseUrl: string): void {
  const root = baseUrl.replace(/\/$/, '');
  const origFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith('/')) {
      url = `${root}${url}`;
    }
    return origFetch(url, init);
  };
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (!configPath) {
    process.stderr.write('Missing config path\n');
    process.exit(1);
  }

  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as WorkerConfig;
  patchFetch(config.baseUrl);
  setLocalServerAvailable(true);

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  try {
    await runBenchmark({
      preset: config.preset,
      suites: config.suites,
      signal: controller.signal,
      binding: {
        providerId: config.providerId,
        modelId: config.modelId,
        provider: config.provider,
      },
      onProgress: emit,
    });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(controller.signal.aborted ? 0 : 1);
  } finally {
    await fs.unlink(configPath).catch(() => undefined);
  }
}

void main();
