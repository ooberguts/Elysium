import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const macInstaller = resolve('scripts/install-macos.sh');
const windowsInstaller = resolve('scripts/install-windows.ps1');
const posix = process.platform !== 'win32';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'elysium-installer-'));
  const root = join(base, "managed source's folder");
  const appDir = join(base, "User's Applications");
  const bin = join(root, 'tools/node/bin');
  const upstream = join(base, 'upstream');
  const git = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  mkdirSync(bin, { recursive: true });
  mkdirSync(appDir);
  mkdirSync(upstream);
  function runGit(...args) {
    return execFileSync(git, ['-C', upstream, ...args], { encoding: 'utf8' }).trim();
  }
  runGit('init', '-b', 'main');
  writeFileSync(join(upstream, 'README.md'), 'Installer fixture');
  writeFileSync(join(upstream, '.gitignore'), 'src-tauri/target/\n');
  runGit('add', '.');
  runGit(
    '-c',
    'user.name=Installer test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'First',
  );
  const commit = runGit('rev-parse', 'HEAD');
  const mock = (name, source) =>
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${source}\n`, { mode: 0o755 });
  mock('uname', '[ "$1" = -s ] && echo Darwin || echo arm64');
  mock('id', 'echo 1000');
  mock('sw_vers', 'echo 15.0');
  mock('xcode-select', 'exit 0');
  mock('xcrun', 'exit 0');
  mock('node', 'if [ "${FAIL_NODE:-0}" = 1 ]; then exit 1; fi; exit 0');
  mock(
    'curl',
    `
output=''
for item in "$@"; do
  if [ "$output" = pending ]; then output="$item"; break; fi
  if [ "$item" = -o ]; then output=pending; fi
done
case "$output" in
  */SHASUMS256.txt) printf '%064d  node-v24.0.0-darwin-arm64.tar.gz\\n' 0 > "$output" ;;
  *) echo 'corrupted download' > "$output" ;;
esac`,
  );
  mock('rustup', 'exit 0');
  mock('pgrep', 'exit 1');
  mock('codesign', '[ "${FAIL_SIGNATURE:-0}" != 1 ]');
  mock('ditto', 'cp -R "$1" "$2"');
  mock('open', 'touch "$ELYSIUM_TEST_BASE/opened"');
  mock(
    'git',
    `
if [ "$1" = clone ]; then
  "$ELYSIUM_REAL_GIT" clone --quiet "$ELYSIUM_UPSTREAM" "$5"
  "$ELYSIUM_REAL_GIT" -C "$5" remote set-url origin https://github.com/ooberguts/Elysium.git
elif [ "$3" = fetch ]; then
  "$ELYSIUM_REAL_GIT" -C "$2" fetch --quiet "$ELYSIUM_UPSTREAM" +refs/heads/main:refs/remotes/origin/main
else
  exec "$ELYSIUM_REAL_GIT" "$@"
fi`,
  );
  mock(
    'npm',
    `
[ "$FAIL_BUILD" != 1 ] || exit 23
if [ "$*" = 'run tauri -- build --locked --bundles app' ]; then
  mkdir -p src-tauri/target/release/bundle/macos/Elysium.app/Contents/MacOS
  printf '#!/bin/bash\\nexit 0\\n' > src-tauri/target/release/bundle/macos/Elysium.app/Contents/MacOS/elysium
  chmod +x src-tauri/target/release/bundle/macos/Elysium.app/Contents/MacOS/elysium
fi`,
  );
  return {
    base,
    root,
    appDir,
    bin,
    commit,
    runGit,
    run(extra = [], environment = {}) {
      return spawnSync(
        '/bin/bash',
        [macInstaller, '--root', root, '--app-dir', appDir, '--no-launch', ...extra],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            ELYSIUM_REAL_GIT: git,
            ELYSIUM_UPSTREAM: upstream,
            ELYSIUM_TEST_BASE: base,
            FAIL_BUILD: '0',
            ...environment,
          },
          timeout: 15000,
        },
      );
    },
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

test(
  'macOS installer installs the exact commit into paths containing spaces and quotes',
  { skip: !posix },
  () => {
    const f = fixture();
    try {
      writeFileSync(join(f.base, 'upstream/README.md'), 'A newer commit on main');
      f.runGit('add', '.');
      f.runGit(
        '-c',
        'user.name=Installer test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'Newer',
      );
      const result = f.run(['--commit', f.commit]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(readFileSync(join(f.root, 'source/README.md'), 'utf8'), 'Installer fixture');
      assert.equal(readFileSync(join(f.root, 'installed-commit.txt'), 'utf8').trim(), f.commit);
      assert.ok(existsSync(join(f.appDir, 'Elysium.app/Contents/MacOS/elysium')));
      assert.ok(!existsSync(join(f.root, 'install.lock')));
      assert.ok(!existsSync(join(f.base, 'opened')));
      const second = f.run(['--commit', f.commit]);
      assert.equal(second.status, 0, second.stdout + second.stderr);
      assert.ok(!existsSync(join(f.appDir, '.Elysium.previous.app')));
    } finally {
      f.cleanup();
    }
  },
);

test('macOS installer refuses modified managed sources', { skip: !posix }, () => {
  const f = fixture();
  try {
    assert.equal(f.run().status, 0);
    writeFileSync(join(f.root, 'source/README.md'), 'Keep my edits');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /local edits/);
    assert.equal(readFileSync(join(f.root, 'source/README.md'), 'utf8'), 'Keep my edits');
    assert.ok(existsSync(join(f.appDir, 'Elysium.app')));
  } finally {
    f.cleanup();
  }
});

test(
  'failed build or signature check preserves the installed application and releases the lock',
  { skip: !posix },
  () => {
    const f = fixture();
    try {
      mkdirSync(join(f.appDir, 'Elysium.app'));
      writeFileSync(join(f.appDir, 'Elysium.app/previous'), 'keep');
      for (const failure of [{ FAIL_BUILD: '1' }, { FAIL_SIGNATURE: '1' }]) {
        const result = f.run([], failure);
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /Installation failed/);
        assert.equal(readFileSync(join(f.appDir, 'Elysium.app/previous'), 'utf8'), 'keep');
        assert.ok(!existsSync(join(f.root, 'install.lock')));
      }
    } finally {
      f.cleanup();
    }
  },
);

test('a failed Node.js checksum prevents installation', { skip: !posix }, () => {
  const f = fixture();
  try {
    const result = f.run([], { FAIL_NODE: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /FAILED/);
    assert.ok(!existsSync(join(f.appDir, 'Elysium.app')));
    assert.ok(!existsSync(join(f.root, 'install.lock')));
  } finally {
    f.cleanup();
  }
});

test(
  'macOS installer rejects concurrent installs and commits outside official main',
  { skip: !posix },
  () => {
    const f = fixture();
    try {
      mkdirSync(join(f.root, 'install.lock'));
      assert.match(f.run().stderr, /Another installation/);
      rmSync(join(f.root, 'install.lock'), { recursive: true });
      const result = f.run(['--commit', '0'.repeat(40)]);
      assert.notEqual(result.status, 0);
      assert.ok(!existsSync(join(f.appDir, 'Elysium.app')));
    } finally {
      f.cleanup();
    }
  },
);

test(
  'macOS options fail before installation for malformed or missing commit input',
  { skip: !posix },
  () => {
    for (const args of [['--commit', 'main'], ['--commit'], ['--wait-pid', 'no'], ['--unknown']]) {
      const result = spawnSync('/bin/bash', [macInstaller, ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
    }
  },
);

const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const hasPowershell = !spawnSync(powershell, ['-NoLogo', '-NoProfile', '-Command', 'exit 0']).error;
test(
  'Windows installer parses in PowerShell and rejects non-SHA versions before setup',
  { skip: !hasPowershell },
  () => {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const parsed = spawnSync(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `$errorsFound=$null; $tokensFound=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(${quote(windowsInstaller)}, [ref]$tokensFound, [ref]$errorsFound); if ($errorsFound.Count) { $errorsFound | Out-String | Write-Output; exit 1 }`,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(parsed.status, 0, parsed.stdout + parsed.stderr);
    const invalid = spawnSync(
      powershell,
      ['-NoLogo', '-NoProfile', '-File', windowsInstaller, '-Commit', 'main'],
      { encoding: 'utf8' },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout + invalid.stderr, /full lowercase Git SHA/);
  },
);
