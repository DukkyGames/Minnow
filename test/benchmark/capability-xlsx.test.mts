import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as XLSX from 'xlsx';

import { CAPABILITY_CATALOG } from '../../src/benchmark/capabilities/catalog.ts';
import type { ManualVerdictStore } from '../../src/benchmark/capabilities/manual-verdicts.ts';
import { manualVerdictKey } from '../../src/benchmark/capabilities/manual-verdicts.ts';
import { buildCapabilityMatrixViewModel } from '../../src/benchmark/capabilities/view-model.ts';
import {
  buildCapabilityMatrixWorkbook,
  CAPABILITY_MATRIX_SHEET_NAMES,
  parseCapabilityMatrixWorkbook,
  parseSpreadsheetVerdictCell,
} from '../../src/benchmark/capabilities/xlsx-workbook.ts';

const TARGET_KEY = 'openai::gpt-roundtrip';

describe('capability matrix xlsx workbook', () => {
  test('parseSpreadsheetVerdictCell accepts emoji and text', () => {
    assert.equal(parseSpreadsheetVerdictCell('✅'), 'pass');
    assert.equal(parseSpreadsheetVerdictCell('⚠️'), 'partial');
    assert.equal(parseSpreadsheetVerdictCell('❌'), 'fail');
    assert.equal(parseSpreadsheetVerdictCell('➖'), 'n-a');
    assert.equal(parseSpreadsheetVerdictCell(''), null);
    assert.equal(parseSpreadsheetVerdictCell('pass'), 'pass');
  });

  test('buildCapabilityMatrixWorkbook includes required sheets and test guide columns', () => {
    const roster = [
      {
        providerId: 'openai',
        modelId: 'gpt-roundtrip',
        label: 'Roundtrip model',
        enabled: true,
      },
    ];
    const manualStore: ManualVerdictStore = {
      [manualVerdictKey(TARGET_KEY, 'core-streaming')]: {
        targetKey: TARGET_KEY,
        capabilityId: 'core-streaming',
        verdict: 'pass',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
      [manualVerdictKey(TARGET_KEY, 'core-tool-calling')]: {
        targetKey: TARGET_KEY,
        capabilityId: 'core-tool-calling',
        verdict: 'partial',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
    };
    const viewModel = buildCapabilityMatrixViewModel({
      roster,
      manualStore,
      campaigns: [],
    });

    const wb = buildCapabilityMatrixWorkbook({
      roster,
      cellByKey: viewModel.cellByKey,
      columnScores: viewModel.columnScores,
    });

    assert.deepEqual(wb.SheetNames, [...CAPABILITY_MATRIX_SHEET_NAMES]);

    const testGuide = XLSX.utils.sheet_to_json(wb.Sheets['Test guide'], {
      header: 1,
      defval: '',
    }) as string[][];
    const headerRow = testGuide.find((row) => row[0] === 'Group' && row[1] === 'Column');
    assert.ok(headerRow);
    assert.deepEqual(headerRow, [
      'Group',
      'Column',
      'Tier',
      'How to test',
      'Scored by',
      'Probe id',
    ]);
    assert.equal(testGuide.length, 5 + CAPABILITY_CATALOG.length);

    const cloud = wb.Sheets.Cloud;
    const cloudRows = XLSX.utils.sheet_to_json(cloud, { header: 1, defval: '' }) as string[][];
    const cloudHeader = cloudRows.find((row) => row[0] === 'Model');
    assert.ok(cloudHeader);
    assert.equal(cloudHeader?.[10], 'Streaming');
  });

  test('round-trip export then parse restores manual verdicts', () => {
    const roster = [
      {
        providerId: 'openai',
        modelId: 'gpt-roundtrip',
        label: 'Roundtrip model',
        enabled: true,
      },
    ];
    const manualStore: ManualVerdictStore = {
      [manualVerdictKey(TARGET_KEY, 'core-streaming')]: {
        targetKey: TARGET_KEY,
        capabilityId: 'core-streaming',
        verdict: 'pass',
        note: 'stream ok',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
      [manualVerdictKey(TARGET_KEY, 'core-json-args')]: {
        targetKey: TARGET_KEY,
        capabilityId: 'core-json-args',
        verdict: 'fail',
        updatedAt: '2026-08-10T12:00:00.000Z',
      },
    };
    const viewModel = buildCapabilityMatrixViewModel({
      roster,
      manualStore,
      campaigns: [],
    });
    const built = buildCapabilityMatrixWorkbook({
      roster,
      cellByKey: viewModel.cellByKey,
      columnScores: viewModel.columnScores,
      manualStore,
    });
    const bytes = XLSX.write(built, { bookType: 'xlsx', type: 'buffer' });
    const readBack = XLSX.read(bytes, { type: 'buffer' });

    const { verdicts, warnings } = parseCapabilityMatrixWorkbook(readBack, { roster });
    assert.equal(warnings.length, 0);

    const byCap = new Map(verdicts.map((v) => [v.capabilityId, v]));
    assert.equal(byCap.get('core-streaming')?.verdict, 'pass');
    assert.equal(byCap.get('core-streaming')?.note, 'stream ok');
    assert.equal(byCap.get('core-json-args')?.verdict, 'fail');
    assert.equal(byCap.size, 2);
  });
});
