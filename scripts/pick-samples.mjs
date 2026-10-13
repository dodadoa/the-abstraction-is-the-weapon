/* Rolls a random sample kit into public/samples from a folder of packs.
   Files are sorted into categories by matching words in the file name, a
   handful are drawn at random per category, and a manifest.json is written
   that the app loads on start. Run again to re-roll the kit.

   usage: node scripts/pick-samples.mjs [source folder] [per category]
          node scripts/pick-samples.mjs --only drone   (re-roll one category, keep the rest) */
import { readdir, stat, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt < 0 ? null : args.splice(onlyAt, 2)[1];
const SRC = args[0] || 'C:/Users/maddo/Documents/Splice/Samples/packs';
const PER = parseInt(args[1], 10) || 12;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
const MAX_BYTES = 1.5 * 1024 * 1024; // one-shots only: keeps the kit small and quick to decode
const AUDIO_EXT = /\.(wav|mp3|ogg|flac|m4a|aif|aiff)$/i;

/* first match wins, so the specific words sit above the catch-alls:
   "glitch_kick_fx.wav" is a kick, not a glitch or an fx */
const CATEGORIES = [
  ['drone',  /drone/i],
  ['kick',   /kick/i],
  ['snare',  /snare/i],
  ['hat',    /hat/i],
  ['shot',   /^(?!.*(reload|cock|bass)).*(gun|laser|zap|pew|rifle|pistol|blaster|cannon|weapon)/i],
  ['impact', /impact/i],
  ['perc',   /perc/i],
  ['glitch', /glitch/i],
  ['fx',     /fx/i],
];
/* the drone bed is looped whole under the intro and the world, so it wants a
   few long files rather than a dozen one-shots */
const LIMITS = {
  drone:{per:4, min:1.5 * 1024 * 1024, max:6 * 1024 * 1024, loops:true},
  shot:{per:24}, impact:{per:24}, // the gun and what it strikes get the deepest pools
};

async function walk(dir, out = []){
  for (const ent of await readdir(dir, {withFileTypes:true})){
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, out);
    else if (AUDIO_EXT.test(ent.name)) out.push(p);
  }
  return out;
}

const files = await walk(SRC);
const bins = Object.fromEntries(CATEGORIES.map(([k])=>[k, []]));
for (const f of files){
  const name = path.basename(f);
  const cat = CATEGORIES.find(([, re])=>re.test(name));
  if (!cat) continue;
  if (/loop/i.test(name) && !(LIMITS[cat[0]] || {}).loops) continue;
  bins[cat[0]].push(f);
}

let manifest = [];
if (ONLY){
  try { manifest = JSON.parse(await readFile(path.join(OUT, 'manifest.json'), 'utf8')); } catch(err){}
  manifest = manifest.filter(it=>it.slot !== ONLY);
  await rm(path.join(OUT, ONLY), {recursive:true, force:true});
} else {
  await rm(OUT, {recursive:true, force:true});
}
for (const [cat] of CATEGORIES){
  if (ONLY && cat !== ONLY) continue;
  const pool = bins[cat];
  const lim = {per:PER, min:0, max:MAX_BYTES, ...LIMITS[cat]};
  for (let i = pool.length - 1; i > 0; i--){ // shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  await mkdir(path.join(OUT, cat), {recursive:true});
  let n = 0;
  for (const f of pool){
    if (n >= lim.per) break;
    const size = (await stat(f)).size;
    if (size > lim.max || size < lim.min) continue;
    const ext = path.extname(f).toLowerCase();
    const file = cat + '/' + String(n + 1).padStart(2, '0') + ext;
    await copyFile(f, path.join(OUT, file));
    manifest.push({slot:cat, file, name:path.basename(f, path.extname(f))});
    n++;
  }
  console.log(cat.padEnd(7), n + ' picked of ' + pool.length + ' matched');
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest.length + ' samples -> ' + OUT);
