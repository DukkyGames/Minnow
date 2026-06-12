# Benchmark App Refactor

Implemented unified Benchmarking lab per the approved plan.

## Shipped

- Tabbed app: Overview, Charts, Tests, Run (`src/ui/benchmark/`)
- Multi-model campaigns (`campaign-runner.ts`, `matrix-scheduler.ts`)
- Model roster (`roster.ts`, sessionStorage)
- Standard mini packs: mmlu-mini, arc-challenge-mini, gsm8k-mini, humaneval-mini, truthfulqa-mini
- Campaign API: `/api/benchmarks/campaigns`, `/api/benchmarks/models`, `/api/benchmarks/datasets`
- Settings Evals redirects to `#/app/bench/tests`
- SVG charts panel; animated overview grid; campaign stepper
- Tests: `test/benchmark/campaign-aggregates.test.mts`, `test/benchmark/standard-scorers.test.mts`

## Pack schema (standard)

```json
{
  "id": "pack-id",
  "label": "Display name",
  "category": "reasoning|math|coding|safety|conversation|agents",
  "scoring": "mcq|numeric|code|regex|judge",
  "items": [
    {
      "id": "item-1",
      "prompt": "...",
      "groundTruth": "B",
      "choices": ["A", "B"],
      "category": "reasoning"
    }
  ]
}
```

Full-tier: import JSON via Tests tab or `POST /api/benchmarks/datasets`. Helper: `node scripts/fetch-benchmark-dataset.mjs`.
