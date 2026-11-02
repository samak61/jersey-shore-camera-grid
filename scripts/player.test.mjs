import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../workers/camera-worker.js';

async function playerHarness(hlsSupported=true){
 const response=await worker.fetch(new Request('https://camera.example/'),{CAMERA_NAME:'Test',SOURCE_URL:'https://source.example/live/index.m3u8'});
 const markup=await response.text(),script=[...markup.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const instances=[],timers=new Map(),delays=[];let next=0,plays=0;
 const video={pause(){},removeAttribute(){},load(){},play(){plays++;return Promise.resolve();},canPlayType(){return 'probably';},addEventListener(){},readyState:0,currentTime:0};
 const message={hidden:false,textContent:'',append(){}};
 class FakeHls{
  static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
  static isSupported(){return hlsSupported;}
  constructor(){this.handlers={};instances.push(this);}
  on(name,callback){this.handlers[name]=callback;}
  loadSource(source){this.source=source;}
  attachMedia(media){this.media=media;}
  destroy(){}
 }
 const context=vm.createContext({URL,Date,Hls:FakeHls,window:{Hls:FakeHls},parent:{},navigator:{userAgent:'Mozilla/5.0 (iPad) Version/26.0 Mobile Safari/605.1.15'},location:{href:'https://camera.example/'},document:{getElementById:id=>id==='video'?video:message,createElement:()=>({})},setInterval(){},setTimeout(fn,delay){const id=++next;timers.set(id,fn);delays.push(delay);return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(script,context);
 return {video,message,instances,timers,delays,get plays(){return plays;}};
}

test('Safari with MSE uses HLS.js even when native HLS is advertised',async()=>{
 const h=await playerHarness();
 assert.equal(h.instances.length,1);
 assert.equal(h.video.src,undefined);
 const player=h.instances[0];
 assert.equal(new URL(player.source).pathname,'/hls/index.m3u8');
 assert.equal(player.media,h.video);
 player.handlers.manifest();
 assert.equal(h.plays,1);
 assert.equal(h.video.muted,true);
 assert.equal(h.video.playsInline,true);
});

test('native-only fallback receives an absolute playlist URL with an m3u8 path',async()=>{
 const h=await playerHarness(false);
 assert.equal(h.instances.length,0);
 const source=new URL(h.video.src);
 assert.equal(source.origin,'https://camera.example');
 assert.equal(source.pathname,'/hls/index.m3u8');
 assert.equal(source.searchParams.get('url'),'https://source.example/live/index.m3u8');
 assert.equal(h.plays,1);
});

test('network failures keep reconnecting after five attempts while denied access stops',async()=>{
 const h=await playerHarness();
 for(let i=0;i<9;i++){
  h.instances.at(-1).handlers.error(null,{fatal:true,response:{code:502}});
  assert.equal(h.timers.size,1);
  const [id,fn]=h.timers.entries().next().value;
  h.timers.delete(id);fn();
 }
 assert.deepEqual(h.delays,[4000,8000,16000,32000,60000,60000,60000,60000,60000]);
 h.instances.at(-1).handlers.error(null,{fatal:true,response:{code:403}});
 assert.equal(h.timers.size,0);
 assert.match(h.message.textContent,/denied/);
});
