// Contracts for the SmallSpace migration: CI runs on the new repository's
// main branch, desktop artifacts are buildable there, and no workflow can
// publish to the original project's release/distribution channels from a
// repository it does not own.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const workflows = join(__dirname, '../workflows');
const read = name => readFileSync(join(workflows, name), 'utf8');

// Top-level job headers plus their single-line needs/if fields, the same
// projection release-publish.test.cjs uses. Shell bodies are indented deeper.
function jobsOf(source) {
  const section = source.slice(source.indexOf('\njobs:\n') + 1);
  return Object.fromEntries([...section.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/gm)]
    .map(([, id, body]) => [id, {
      needs: (body.match(/^    needs: (.+)$/m)?.[1] ?? '').split(/[\s,\[\]]+/).filter(Boolean),
      condition: body.match(/^    if: (.+)$/m)?.[1] ?? '',
    }]));
}

function ancestors(jobs, id, found = new Set()) {
  for (const parent of jobs[id].needs) {
    if (found.has(parent)) continue;
    found.add(parent);
    ancestors(jobs, parent, found);
  }
  return found;
}

test('CI runs on SmallSpace main pushes, pull requests and manual dispatch', () => {
  const ci = read('ci.yml');
  const on = ci.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? '';
  assert.match(on, /^  push:/m);
  assert.match(on, /^  pull_request:/m);
  assert.match(on, /^  workflow_dispatch:/m);
  assert.match(on, /branches: \[dev, main, feat\/ui-next\]/);
  assert.match(ci, /--fail-under-lines 85/, 'the Rust coverage floor must not be weakened');
  assert.match(ci, /pnpm test/, 'the frontend coverage gate must remain');
});

test('desktop CI builds unsigned macOS Apple Silicon and Linux artifacts', () => {
  assert.ok(existsSync(join(workflows, 'desktop-build.yml')), 'desktop-build.yml is missing');
  const build = read('desktop-build.yml');
  const on = build.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? '';
  assert.match(on, /^  push:/m);
  assert.match(on, /^  pull_request:/m);
  assert.match(on, /^  workflow_dispatch:/m);
  assert.match(on, /branches: \[main\]/);
  assert.match(build, /runner: macos-15/, 'macOS must use a supported Apple Silicon runner');
  assert.match(build, /aarch64-apple-darwin/);
  assert.match(build, /ubuntu-22\.04/);
  assert.doesNotMatch(build, /windows/i, 'no Windows leg is needed');
  assert.match(build, /name: srelens-desktop-macos-arm64/);
  assert.match(build, /name: srelens-desktop-linux-x86_64/);
  assert.match(build, /actions\/upload-artifact@[0-9a-f]{40}/, 'artifact upload must be SHA-pinned');
  assert.doesNotMatch(build, /tauri-apps\/tauri-action/, 'CI artifacts are not releases');
  assert.doesNotMatch(build, /softprops\/action-gh-release/);
  assert.doesNotMatch(build, /ghcr\.io/);
  assert.doesNotMatch(build, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(build, /createUpdaterArtifacts":false/, 'unsigned CI builds must not emit updater signatures');
});

test('SmallSpace checks its own releases for updates', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '../../apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  assert.deepEqual(config.plugins.updater.endpoints, [
    'https://github.com/1tuz/SmallSpace/releases/latest/download/latest.json',
  ]);
});

test('release publishers are unreachable outside the original repository', () => {
  const release = read('release.yml');
  const jobs = jobsOf(release);
  assert.match(jobs.version.condition, /github\.repository == 'srelens\/srelens'/,
    'the version job is the release graph root and must be repository-gated');
  for (const id of Object.keys(jobs)) {
    if (id === 'version') continue;
    assert.ok(ancestors(jobs, id).has('version'), `${id} must depend on the gated version job`);
  }
  assert.match(release, /ghcr\.io\/srelens\/srelens/,
    'the original image target stays in source, behind the repository gate');
});

test('distribution channels and scorecard publication stay original-repository-only', () => {
  for (const name of ['aur-publish.yml', 'homebrew-publish.yml']) {
    const jobs = jobsOf(read(name));
    for (const [id, job] of Object.entries(jobs)) {
      assert.match(job.condition, /github\.repository == 'srelens\/srelens'/, `${name}:${id}`);
    }
  }
  const scorecard = read('scorecard.yml');
  assert.match(scorecard, /publish_results: \$\{\{ github\.repository == 'srelens\/srelens' \}\}/);
});
