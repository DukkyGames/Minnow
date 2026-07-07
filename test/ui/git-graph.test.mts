import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  annotateBranchLineSegments,
  annotateCommitLines,
  annotateMainTrunkSegments,
  assignCommitVisuals,
  buildMainlineSet,
  detectTrunkBranch,
  extractLocalBranchRefs,
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

    assert.equal(visuals[0].mainLine, 'none');
    assert.equal(visuals[1].mainLine, 'down');
    assert.equal(visuals[2].mainLine, 'both');
    assert.equal(visuals[3].mainLine, 'up');
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

    assert.equal(visuals[0].mainLine, 'down');
    assert.equal(visuals[1].mainLine, 'through');
    assert.equal(visuals[2].mainLine, 'both');
    assert.equal(visuals[3].mainLine, 'up');
  });
});

describe('annotateBranchLineSegments', () => {
  it('connects named branch commits across rows in between', () => {
    const visuals = annotateBranchLineSegments(
      assignCommitVisuals(
        [
          commit('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', [
            'dddddddddddddddddddddddddddddddddddddddd',
          ], { refs: ['feature/test'] }),
          commit('dddddddddddddddddddddddddddddddddddddddd', [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ], { refs: ['feature/test'] }),
        ],
        'main',
      ),
    );

    assert.equal(visuals[0].branchLine?.segment, 'down');
    assert.equal(visuals[1].branchLine?.segment, 'up');
  });

  it('does not connect separate branches that share only a fallback key', () => {
    const visuals = annotateBranchLineSegments(
      assignCommitVisuals(
        [
          commit('dddddddddddddddddddddddddddddddddddddddd', ['cccccccccccccccccccccccccccccccccccccccc'], {
            refs: ['feature/a'],
          }),
          commit('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', ['ffffffffffffffffffffffffffffffffffffffff'], {
            refs: ['feature/b'],
          }),
        ],
        'main',
      ),
    );

    assert.equal(visuals[0].branchLine, undefined);
    assert.equal(visuals[1].branchLine, undefined);
  });

  it('bridges named branch commits separated by main commits', () => {
    const visuals = annotateCommitLines(
      assignCommitVisuals(
        [
          commit('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', [
            'dddddddddddddddddddddddddddddddddddddddd',
          ], { refs: ['feature/test'] }),
          commit('cccccccccccccccccccccccccccccccccccccccc', [
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          ], { refs: ['HEAD -> main'] }),
          commit('dddddddddddddddddddddddddddddddddddddddd', [
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          ], { refs: ['feature/test'] }),
        ],
        'main',
      ),
    );

    assert.equal(visuals[0].branchLine?.segment, 'down');
    assert.equal(visuals[1].branchLine?.segment, 'through');
    assert.equal(visuals[2].branchLine?.segment, 'up');
    assert.equal(visuals[1].isMain, true);
    assert.equal(visuals[1].mainLine, 'none');
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

describe('extractLocalBranchRefs', () => {
  it('keeps local branches and HEAD pointers', () => {
    const refs = extractLocalBranchRefs([
      'HEAD -> main',
      'feature/foo',
      'origin/main',
      'remotes/origin/dev',
      'tag: v1.0',
    ]);
    assert.deepEqual(refs, ['main', 'feature/foo']);
  });

  it('deduplicates branch names', () => {
    const refs = extractLocalBranchRefs(['main', 'HEAD -> main']);
    assert.deepEqual(refs, ['main']);
  });
});
