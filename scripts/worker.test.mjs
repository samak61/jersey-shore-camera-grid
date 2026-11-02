import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,readdir} from 'node:fs/promises';
import worker from '../workers/camera-worker.js';
const env={CAMERA_NAME:'Sea Girt Center',SOURCE_URL:'https://seagirt.cdn.coastalcameranetwork.com/New_Jersey/seagirt.stream/index.m3u8'};
const originalFetch=globalThis.fetch;
const get=(path,customEnv=env)=>worker.fetch(new Request('https://camera.example'+path),customEnv);
test('worker confines requests, rewrites playlists, preserves access denials and serves parseable player',async()=>{
 let calls=0;globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.get('Referer'),'https://coastalcameranetwork.com/');assert.equal(options.headers.get('Origin'),'https://coastalcameranetwork.com');return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});};
 try{
  for(const url of ['https://example.com/x.m3u8','http://seagirt.cdn.coastalcameranetwork.com/New_Jersey/seagirt.stream/index.m3u8','https://seagirt.cdn.coastalcameranetwork.com/private/index.m3u8','https://user:pass@seagirt.cdn.coastalcameranetwork.com/New_Jersey/seagirt.stream/index.m3u8']){assert.equal((await get('/stream?url='+encodeURIComponent(url))).status,403);}assert.equal(calls,0);
  let r=await get('/stream');assert.equal(r.status,200);const text=await r.text();assert.match(text,/URI="https:\/\/camera\.example\/hls\/key\.bin\?url=/);assert.match(text,/%2Fsegment.ts/);assert.match(text,/%2Fkey.bin/);
  globalThis.fetch=async()=>new Response('denied',{status:403});assert.equal((await get('/stream')).status,403);
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://example.com/private'}});assert.equal((await get('/stream')).status,502);
  r=await get('/');assert.equal(r.status,200);const markup=await r.text();assert.match(markup,/Sea Girt Center/);for(const match of markup.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  assert.equal((await get('/?url='+encodeURIComponent('https://example.com/x.m3u8'))).status,403);
 }finally{globalThis.fetch=originalFetch;}
});
test('nine tiles use nine new Workers without the original Sea Girt proxy',async()=>{
 const cameras=JSON.parse(await readFile(new URL('../cameras.json',import.meta.url),'utf8'));
 assert.equal(cameras.length,9);assert.equal(cameras.some(c=>c.existing),false);
 assert.equal(new Set(cameras.map(c=>c.worker)).size,9);
 const source=await readFile(new URL('../public/cameras.js',import.meta.url),'utf8');
 const sandbox={window:{}};vm.runInNewContext(source,sandbox);
 assert.equal(sandbox.window.CAMERA_DEFAULTS.length,9);
 for(const c of sandbox.window.CAMERA_DEFAULTS){assert.equal(c.external,false);assert.doesNotMatch(c.url,/wail-dorado7m|sea-girt-north1/);}
 assert.match(sandbox.window.CAMERA_DEFAULTS[4].url,/beach-wall-sea-girt-north\./);
 assert.equal((await readdir(new URL('../workers/configs/',import.meta.url))).length,9);
});

test('all nine camera configurations use the working Sea Girt headers for playlists and media',async()=>{
 const cameras=JSON.parse(await readFile(new URL('../cameras.json',import.meta.url),'utf8'));
 const expected={referer:'https://coastalcameranetwork.com/',origin:'https://coastalcameranetwork.com','user-agent':'Mozilla/5.0 (AppleTV; tvOS) AppleWebKit/605.1.15 (KHTML, like Gecko)',accept:'*/*'};
 try{
  for(const camera of cameras.filter(c=>!c.existing)){
   const config=JSON.parse(await readFile(new URL('../workers/configs/'+camera.id+'/wrangler.json',import.meta.url),'utf8'));
   let calls=0;
   globalThis.fetch=async(url,options)=>{
    calls++;
    for(const [name,value] of Object.entries(expected))assert.equal(options.headers.get(name),value,camera.id+' '+name);
    assert.equal(options.headers.has('Authorization'),false);
    assert.equal(options.headers.has('Cookie'),false);
    if(calls===1){assert.equal(url,config.vars.SOURCE_URL);return new Response('#EXTM3U\nsegment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});}
    assert.equal(url,new URL('segment.ts',config.vars.SOURCE_URL).href);
    assert.equal(options.headers.get('Range'),'bytes=0-3');
    return new Response('data',{status:206,headers:{'Content-Type':'video/MP2T','Content-Range':'bytes 0-3/4','Content-Length':'4'}});
   };
   const playlist=await get('/stream',config.vars);assert.equal(playlist.status,200);
   const segment=(await playlist.text()).trim().split('\n')[1];
   const response=await worker.fetch(new Request(new URL(segment,'https://camera.example'),{headers:{Range:'bytes=0-3',Referer:'https://viewer.example/',Origin:'https://viewer.example',Authorization:'test-credential',Cookie:'session=test'}}),config.vars);
   assert.equal(response.status,206);assert.equal(response.headers.get('Content-Type'),'video/mp2t');assert.equal(response.headers.get('Content-Range'),'bytes 0-3/4');assert.equal(await response.text(),'data');assert.equal(calls,2);
  }
 }finally{globalThis.fetch=originalFetch;}
});
