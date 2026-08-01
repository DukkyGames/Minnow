/**
 * Education Mode execution layer — tool dispatch block, shell denylist,
 * and parity between the browser guard and its server mirror.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  blockEducationModeWrite,
  blockEducationShellWrite,
} from '../../src/chat/modes/education-guard.ts';
import {
  EDUCATION_DENIED_TOOL_IDS as SERVER_DENIED_TOOL_IDS,
  blockEducationModeWrite as serverBlockWrite,
  blockEducationShellWrite as serverBlockShell,
} from '../../server/tools/education-guard.js';
import { EDUCATION_DENIED_TOOL_IDS } from '../../src/chat/modes/education-overlay.ts';

/** Commands the tutor must be able to run: tests, inspection, read-only pipelines. */
const ALLOWED_COMMANDS = [
  'npm test',
  'npm test 2>&1 | tail -20',
  'npm run test:settings',
  'pytest -q',
  'pytest -q 2>/dev/null',
  'git diff',
  'git status --short',
  'git log --oneline -20',
  'git add -A',
  'git commit -m "wip"',
  'git checkout -b feature/thing',
  'grep -r foo src',
  'grep -rn "a > b" src',
  'cat package.json',
  'ls -la src',
  'node --version',
  'python3 --version',
  'npx tsc --noEmit',
  'CI=1 npm test',
  'Get-Content package.json',
  'Get-ChildItem src | Select-Object Name',
  'npm test 2>$null',
  'find . -name "*.test.mjs"',
];

/** Commands that would put the agent back in the editor's seat. */
const BLOCKED_COMMANDS = [
  'echo x > f.js',
  'echo x >> f.js',
  'cat <<EOF > src/app.ts',
  'printf "hi" > out.txt',
  'npm test > results.txt',
  'tee src/app.ts',
  'echo hi | tee src/app.ts',
  'sed -i "s/a/b/" src/app.ts',
  'sed -i.bak "s/a/b/" src/app.ts',
  'sed --in-place "s/a/b/" src/app.ts',
  'perl -pi -e "s/a/b/" src/app.ts',
  'patch -p1 < fix.diff',
  'cp src/a.ts src/b.ts',
  'mv src/a.ts src/b.ts',
  'rm src/a.ts',
  'rm -rf build',
  'mkdir -p src/new',
  'touch src/new.ts',
  'dd if=/dev/zero of=f',
  'truncate -s 0 src/app.ts',
  'python -c "open(\'f.py\',\'w\').write(1)"',
  'python3 -c "print(1)"',
  'node -e "require(\'fs\').writeFileSync(1,2)"',
  'node --eval "1"',
  'ruby -e "puts 1"',
  'git apply fix.patch',
  'git checkout -- src/app.ts',
  'git restore src/app.ts',
  'git reset --hard HEAD',
  'git clean -fd',
  'npm test && rm -rf build',
  'npm test; echo done > log.txt',
  'find . -name "*.ts" -exec rm {} \\;',
  'ls src | xargs rm',
  'sudo rm -rf /tmp/x',
  'Set-Content -Path src/app.ts -Value "x"',
  'Get-Content a.txt | Out-File b.txt',
  'New-Item -ItemType File src/new.ts',
  'Remove-Item -Recurse build',
  'Copy-Item a.ts b.ts',
  '/usr/bin/tee src/app.ts',
  'rm.exe src/app.ts',
];

describe('education shell denylist', () => {
  for (const command of ALLOWED_COMMANDS) {
    test(`allows: ${command}`, () => {
      assert.equal(
        blockEducationShellWrite(command),
        null,
        `read-only command was blocked: ${command}`,
      );
    });
  }

  for (const command of BLOCKED_COMMANDS) {
    test(`blocks: ${command}`, () => {
      const out = blockEducationShellWrite(command);
      assert.ok(out, `write command slipped through: ${command}`);
      assert.match(out, /Education Mode/);
    });
  }

  test('ignores empty and non-string commands', () => {
    assert.equal(blockEducationShellWrite(''), null);
    assert.equal(blockEducationShellWrite('   '), null);
    assert.equal(blockEducationShellWrite(undefined), null);
    assert.equal(blockEducationShellWrite(42), null);
  });
});

describe('education tool dispatch guard', () => {
  test('returns null for every tool when disabled', () => {
    for (const id of EDUCATION_DENIED_TOOL_IDS) {
      assert.equal(blockEducationModeWrite(false, id, { path: 'src/a.ts' }), null);
    }
    assert.equal(blockEducationModeWrite(false, 'execute_command', { command: 'rm -rf x' }), null);
  });

  test('blocks every denied tool when enabled', () => {
    for (const id of EDUCATION_DENIED_TOOL_IDS) {
      const out = blockEducationModeWrite(true, id, { path: 'src/a.ts' });
      assert.ok(out, `${id} was not blocked`);
      assert.match(out, /Education Mode/);
    }
  });

  test('update_settings gets its own message pointing at the UI', () => {
    const out = blockEducationModeWrite(true, 'update_settings', {});
    assert.match(out, /update_settings/);
    assert.match(out, /Settings/);
  });

  test('write message invites the student to propose the change', () => {
    const out = blockEducationModeWrite(true, 'save_file', { path: 'src/a.ts' });
    assert.match(out, /review it/);
  });

  test('user-initiated file tools bypass the guard (Code viewer / tree)', () => {
    assert.equal(
      blockEducationModeWrite(true, 'save_file', { path: 'src/a.ts' }, 'user'),
      null,
    );
    assert.equal(blockEducationModeWrite(true, 'delete_path', { path: 'src/a.ts' }, 'user'), null);
    assert.ok(blockEducationModeWrite(true, 'save_file', { path: 'src/a.ts' }, 'agent'));
  });

  test('shell tools route through the denylist, read-only calls pass', () => {
    assert.equal(blockEducationModeWrite(true, 'execute_command', { command: 'npm test' }), null);
    assert.ok(blockEducationModeWrite(true, 'execute_command', { command: 'rm -rf src' }));
    assert.ok(
      blockEducationModeWrite(true, 'start_background_command', { command: 'tee src/a.ts' }),
    );
  });

  test('read tools are never blocked', () => {
    for (const id of ['read_file', 'grep', 'git_diff', 'repo_map', 'todo_write']) {
      assert.equal(blockEducationModeWrite(true, id, {}), null);
    }
  });

  test('MCP write tools are blocked at dispatch too', () => {
    assert.ok(blockEducationModeWrite(true, 'mcp__filesystem__write_file', {}));
    assert.equal(blockEducationModeWrite(true, 'mcp__filesystem__read_file', {}), null);
  });
});

describe('server guard mirrors the browser guard', () => {
  test('denied tool sets are identical', () => {
    assert.deepEqual(
      [...SERVER_DENIED_TOOL_IDS].sort(),
      [...EDUCATION_DENIED_TOOL_IDS].sort(),
    );
  });

  test('both agree on the whole shell corpus', () => {
    for (const command of [...ALLOWED_COMMANDS, ...BLOCKED_COMMANDS]) {
      assert.equal(
        serverBlockShell(command) === null,
        blockEducationShellWrite(command) === null,
        `guards disagree on: ${command}`,
      );
    }
  });

  test('both agree on tool dispatch', () => {
    const cases = [
      ['save_file', {}],
      ['update_settings', {}],
      ['read_file', {}],
      ['mcp__fs__write_file', {}],
      ['execute_command', { command: 'npm test' }],
      ['execute_command', { command: 'sed -i s/a/b/ f' }],
    ];
    for (const [name, args] of cases) {
      assert.equal(
        serverBlockWrite(true, name, args),
        blockEducationModeWrite(true, name, args),
        `guards disagree on tool: ${name}`,
      );
    }
  });
});
