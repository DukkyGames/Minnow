/**
 * House rules and legend text from the capability matrix Read me sheet.
 */

export const CAPABILITY_MATRIX_TITLE = 'Minnow model capability matrix';

export const CAPABILITY_MATRIX_HOUSE_RULES: string[] = [
  'Pick a row. Set Date tested and work left to right through the capability columns.',
  'Every capability cell is a dropdown. Leave it blank until you have actually tried it.',
  '✅ works | ⚠️ works but with a caveat (write it in Notes) | ❌ broken | ➖ not applicable on this host.',
  'Anything that stops you using the model for real work goes in Blocking issues. Everything else in Notes.',
  'Set the Verdict when you are done with a row. Score and Tested (n) calculate themselves.',
  'Hover any capability header for its tier and a concrete prompt to test it with.',
];

export const CAPABILITY_TIER_DESCRIPTIONS: Record<1 | 2 | 3, string> = {
  1: 'Tier 1 — triage (18 cols): if a model fails any of these it is not usable in Minnow.',
  2: 'Tier 2 — real work: separates a chat toy from something you can run Build, Orchestrate or Super Plan with.',
  3: 'Tier 3 — breadth: apps, browser, voice, email, docs. Nice to have; test last.',
};

export const CAPABILITY_VERDICT_LEGEND: Record<string, string> = {
  pass: 'Works — did the job unprompted and correctly',
  partial: 'Partial — works but needed nudging, retried, or got it right only sometimes',
  fail: 'Broken — wrong output, malformed call, ignored the tool, or hung',
  'n-a': 'Not applicable — the feature is not reachable on this host / model',
  untested: 'Not tested yet',
};

/** Spreadsheet score formula (n-a and blanks excluded). */
export const CAPABILITY_SCORE_FORMULA_DESCRIPTION =
  '(passes + half the partials) / everything scored as pass, partial or fail. N/A and blanks are excluded.';
