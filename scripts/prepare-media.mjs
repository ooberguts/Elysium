import ffmpeg from 'ffmpeg-static';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!ffmpeg) throw new Error('FFmpeg is unavailable for this build platform.');
const dir = resolve('src-tauri/resources/bin');
await mkdir(dir, { recursive: true });
const target = resolve(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
await copyFile(ffmpeg, target);
await chmod(target, 0o755);
for (const name of ['ffmpeg.LICENSE', 'ffmpeg.README']) {
  await copyFile(resolve('node_modules/ffmpeg-static', name), resolve(dir, name));
}
console.log('Prepared FFmpeg compatibility helper for', process.platform, process.arch);
await import('./create-samples.mjs');
