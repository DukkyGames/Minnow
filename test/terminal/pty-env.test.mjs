import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPtySpawnEnv } from '../../server/terminal/pty-env.js';

describe('buildPtySpawnEnv', () => {
  it('drops host TTY size and multiplexer vars that break zsh zle', () => {
    const env = buildPtySpawnEnv(
      {
        PATH: '/usr/bin',
        TERM: 'dumb',
        COLUMNS: '40',
        LINES: '10',
        TERMCAP: 'x',
        TMUX: '1',
        ELECTRON_RUN_AS_NODE: '1',
        COLORTERM: 'truecolor',
      },
      { workspaceRoot: '/tmp/workspace' },
    );

    assert.equal(env.TERM, 'xterm-256color');
    assert.equal(env.COLORTERM, 'truecolor');
    assert.equal(env.TERM_PROGRAM, 'Minnow');
    assert.equal(env.MINNOW_WORKSPACE_ROOT, '/tmp/workspace');
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.COLUMNS, undefined);
    assert.equal(env.LINES, undefined);
    assert.equal(env.TERMCAP, undefined);
    assert.equal(env.TMUX, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });

  it('fills COLORTERM when the host did not set it', () => {
    const env = buildPtySpawnEnv({ PATH: '/bin' });
    assert.equal(env.COLORTERM, 'truecolor');
  });

  it('skips undefined host values so node-pty receives only strings', () => {
    const env = buildPtySpawnEnv({ PATH: '/bin', EMPTY: undefined });
    assert.equal(env.EMPTY, undefined);
    assert.equal(env.PATH, '/bin');
  });

  it('merges MSYS keys when gitBash is set', () => {
    const env = buildPtySpawnEnv({ PATH: '/bin' }, { gitBash: true });
    assert.equal(env.CHERE_INVOKING, '1');
    assert.equal(env.MSYSTEM, 'MINGW64');
    assert.equal(env.MSYS, 'enable_pcon');
    assert.equal(env.MSYS2_PATH_TYPE, 'inherit');
    assert.equal(env.TERM, 'xterm-256color');
  });
});
