import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {validateSubdomain} from './account.mjs';

const root = new URL('../', import.meta.url);
const subdomain = validateSubdomain(process.env.WORKERS_SUBDOMAIN);
const cameras = JSON.parse(await readFile(new URL('cameras.json', root), 'utf8'));
if (cameras.length !== 9 || cameras.some(c => c.existing || !/^beach-wall-[a-z-]+$/.test(c.worker))) {
  throw new Error('The isolated grid must contain nine dedicated beach-wall Workers.');
}
if (new Set(cameras.map(c => c.worker)).size !== 9) throw new Error('Camera Worker names must be unique.');
const output = [];
for (const camera of cameras) {
  const directory = new URL(`workers/configs/${camera.id}/`, root);
  await mkdir(directory, {recursive: true});
  await writeFile(new URL('wrangler.json', directory), JSON.stringify({
    name: camera.worker, main: '../../camera-worker.js', compatibility_date: '2026-10-27',
    workers_dev: true, vars: {CAMERA_NAME: camera.name, SOURCE_URL: camera.source}
  }, null, 2) + '\n');
  output.push({name: camera.name, url: `https://${camera.worker}.${subdomain}.workers.dev/`, page: camera.page, external: false});
}
await writeFile(new URL('public/cameras.js', root), 'window.CAMERA_DEFAULTS = ' + JSON.stringify(output, null, 2) + ';\n');
await writeFile(new URL('public/.nojekyll', root), '');
console.log('Prepared nine dedicated camera Workers in the separate account.');
