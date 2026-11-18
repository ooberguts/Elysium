import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const [root, version, repository] = process.argv.slice(2);
if (!root || !/^0\.3\.\d+$/.test(version ?? '') || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
  throw new Error('Usage: update-manifest.mjs <artifact directory> <version> <owner/repository>');
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])),
    )
  ).flat();
}
const all = await files(root);
const findOne = (matches, description) => {
  if (matches.length !== 1)
    throw new Error(`Expected exactly one ${description}; found ${matches.length}`);
  return matches[0];
};
const mac = findOne(
  all.filter((p) => p.endsWith('.app.tar.gz')),
  'macOS update archive',
);
const win = findOne(
  all.filter((p) => /\.exe$/i.test(p)),
  'Windows installer',
);
const signature = async (p) => {
  const sig = (await readFile(`${p}.sig`, 'utf8')).trim();
  if (!sig) throw new Error(`Empty signature for ${basename(p)}`);
  return sig;
};
const macArtifact = mac.split(/[\\/]/).find((p) => p.startsWith('Elysium-macOS-'));
if (!macArtifact) throw new Error('Cannot determine macOS architecture');
const arch = macArtifact.includes('-ARM64-')
  ? 'aarch64'
  : macArtifact.includes('-X64-')
    ? 'x86_64'
    : null;
if (!arch) throw new Error('Unsupported macOS artifact architecture');
const url = (p) =>
  `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(basename(p))}`;
const manifest = {
  version,
  notes: 'A new Elysium release is ready.',
  platforms: {
    [`darwin-${arch}`]: { signature: await signature(mac), url: url(mac) },
    'windows-x86_64': { signature: await signature(win), url: url(win) },
  },
};
await writeFile(join(root, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
