import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  annotateMainTrunkSegments,
  assignCommitVisuals,
  buildMainlineSet,
  detectTrunkBranch,
} from '../../src/ui/git-graph.ts';
import type { GitCommitEntry } from '../../src/state/git-api.ts';

function commit(
  hash: string,
  parents: string[],
  overrides: Partial<GitCommitEntry> = {},
): GitCommitEntry {
  return {
    hash,
    parents,
    subject: overrides.subject ?? hash.slice(0, 7),
    author: overrides.author ?? 'author',
    relativeTime: overrides.relativeTime ?? '1 day ago',
    refs: overrides.refs ?? [],
  };
}

describe('detectTrunkBranch', () => {
  it('prefers main when present in refs', () => {
    const trunk = detectTrunkBranch([
      commit('cccccccccccccccccccccccccccccccccccccccc', [], {
        refs: ['HEAD -> main', 'origin/main'],
      }),
    ]);
    assert.equal(trunk, 'main');
  });
});

describe('assignCommitVisuals', () => {
  it('marks mainline commits with no indent and branch commits with indent', () => {
    const commits = [
      commit('cccccccccccccccccccccccccccccccccccccccc', [
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ], { refs: ['HEAD -> main'] }),
      commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ]),
      commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', []),
    ];

    const visuals = assignCommitVisuals(commits, 'main');
    assert.equal(visuals[0].isMain, true);
    assert.equal(visuals[0].indentPx, 0);
    assert.equal(visuals[1].isMain, true);
    assert.equal(visuals[2].isMain, true);
  });

  it('indents commits on a side branch', () => {
    const commits = [
      commit('dddddddddddddddddddddddddddddddddddddddd', [
        'cccccccccccccccccccccccccccccccccccccccc',
      ], { refs: ['feature/test'] }),
      commit('cccccccccccccccccccccccccccccccccccccccc', [
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ], { refs: ['HEAD -> main'] }),
      commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ]),
      commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', []),
    ];

    const visuals = assignCommitVisuals(commits, 'main');
    assert.equal(visuals[0].isMain, false);
    assert.equal(visuals[0].indentPx, 14);
    assert.equal(visuals[0].branchKey, 'feature/test');
    assert.equal(visuals[1].isMain, true);
  });
});

describe('annotateMainTrunkSegments', () => {
  it('connects main commits with a through segment for rows in between', () => {
    const visuals = annotateMainTrunkSegments(
      assignCommitVisuals(
        [
          commit('dddddddddddddddddddddddddddddddddddddddd', [
            'cccccccccccccccccccccccccccccccccccccccc',
          ], { refs: ['feature/test'] }),
          commit('cccccccccccccccccccccccccccccccccccccccc', [
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          ], { refs: ['HEAD -> main'] }),
          commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ]),
          commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', []),
        ],
        'main',
      ),
    );

    assert.equal(visuals[0].trunkSegment, 'none');
    assert.equal(visuals[1].trunkSegment, 'down');
    assert.equal(visuals[2].trunkSegment, 'both');
    assert.equal(visuals[3].trunkSegment, 'up');
  });

  it('draws a through segment on branch rows between main commits', () => {
    const visuals = annotateMainTrunkSegments(
      assignCommitVisuals(
        [
          commit('cccccccccccccccccccccccccccccccccccccccc', [
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          ], { refs: ['HEAD -> main'] }),
          commit('dddddddddddddddddddddddddddddddddddddddd', [
            'ffffffffffffffffffffffffffffffffffffffff',
          ], { refs: ['feature/test'] }),
          commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ]),
          commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', []),
        ],
        'main',
      ),
    );

    assert.equal(visuals[0].trunkSegment, 'down');
    assert.equal(visuals[1].trunkSegment, 'through');
    assert.equal(visuals[2].trunkSegment, 'both');
    assert.equal(visuals[3].trunkSegment, 'up');
  });
});

describe('buildMainlineSet', () => {
  it('follows first parents from the trunk tip', () => {
    const commits = [
      commit('cccccccccccccccccccccccccccccccccccccccc', [
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ], { refs: ['HEAD -> main'] }),
      commit('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ]),
      commit('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', []),
    ];

    const mainline = buildMainlineSet(commits, 'main');
    assert.equal(mainline.size, 3);
  });
});
