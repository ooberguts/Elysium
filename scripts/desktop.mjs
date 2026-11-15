import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const cargo = join(homedir(), '.cargo', 'bin');
const env = { ...process.env };
if (existsSync(cargo)) env.PATH = `${cargo}${delimiter}${env.PATH || ''}`;
const args = process.argv.slice(2);
if (args[0] === 'build' && !args.includes('--bundles'))
  args.push(
    '--bundles',
    process.platform === 'darwin' ? 'app,dmg' : process.platform === 'win32' ? 'nsis' : 'appimage',
  );
const child = spawn(process.execPath, [resolve('node_modules/@tauri-apps/cli/tauri.js'), ...args], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
