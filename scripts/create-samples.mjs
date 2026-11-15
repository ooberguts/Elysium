import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';

const dir = resolve('src-tauri/resources/demo');
await mkdir(dir, { recursive: true });
function run(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(r.stderr);
}
const songs = [
  ['01 - Glass Horizon', [220, 261.63, 329.63, 293.66]],
  ['02 - After the Rain', [196, 246.94, 293.66, 329.63]],
  ['03 - Silver Lines', [164.81, 220, 261.63, 329.63]],
];
for (let index = 0; index < songs.length; index++) {
  const [title, notes] = songs[index];
  const output = resolve(dir, title + '.mp3');
  if (existsSync(output)) continue;
  const rate = 44100,
    seconds = 16,
    count = rate * seconds;
  const buffer = Buffer.alloc(44 + count * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      beat = t % 0.5,
      f = notes[Math.floor(t * 2) % notes.length],
      env = Math.exp(-beat * 6),
      fade = Math.min(1, t, seconds - t);
    const bass = Math.sin((t * 2 * Math.PI * notes[0]) / 2) * 0.12;
    const lead = (Math.sin(t * 2 * Math.PI * f) + 0.2 * Math.sin(t * 4 * Math.PI * f)) * env * 0.18;
    const l = Math.round((lead + bass) * fade * 32767);
    const r = Math.round((lead * 0.9 + bass) * fade * 32767);
    buffer.writeInt16LE(l, 44 + i * 4);
    buffer.writeInt16LE(r, 46 + i * 4);
  }
  const wav = resolve(dir, 'temp.wav');
  await writeFile(wav, buffer);
  run([
    '-i',
    wav,
    '-c:a',
    'libmp3lame',
    '-q:a',
    '3',
    '-metadata',
    'title=' + title.slice(5),
    '-metadata',
    'artist=Elysium Lab',
    '-metadata',
    'album=First Light',
    '-metadata',
    'genre=Electronic',
    '-metadata',
    'date=2026',
    '-metadata',
    'track=' + String(index + 1),
    output,
  ]);
}
const { unlink } = await import('node:fs/promises');
await unlink(resolve(dir, 'temp.wav')).catch(() => {});
const movie = resolve(dir, 'The Aurora Study.mp4');
if (!existsSync(movie)) {
  run([
    '-f',
    'lavfi',
    '-i',
    'gradients=size=960x540:rate=24:c0=0x14334b:c1=0x80cfb3:c2=0x615986:c3=0x141e32:nb_colors=4:speed=0.08',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=164.81:sample_rate=44100',
    '-t',
    '12',
    '-vf',
    'format=yuv420p',
    '-af',
    'volume=0.07,afade=t=in:d=2,afade=t=out:st=10:d=2',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    movie,
  ]);
}
await writeFile(
  resolve(dir, 'The Aurora Study.nfo'),
  '<?xml version="1.0" encoding="UTF-8"?><movie><title>The Aurora Study</title><year>2026</year><genre>Short Film</genre><plot>An original moving color study generated for Elysium. Use this sample to test video playback, seeking, and resume.</plot></movie>',
);
const episode = resolve(dir, 'Signal House - S01E01 - First Contact.mp4');
if (!existsSync(episode)) {
  const { copyFile } = await import('node:fs/promises');
  await copyFile(movie, episode);
}
await writeFile(
  resolve(dir, 'Signal House - S01E01 - First Contact.nfo'),
  '<?xml version="1.0" encoding="UTF-8"?><episodedetails><title>First Contact</title><showtitle>Signal House</showtitle><season>1</season><episode>1</episode><year>2026</year><plot>A generated sample episode for testing your TV library.</plot></episodedetails>',
);
console.log('Prepared five original sample media files.');
