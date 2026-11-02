import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../workers/camera-worker.js';

async function playerHarness(hlsSupported=true){
 const response=await worker.fetch(new Request('https://camera.example/'),{CAMERA_NAME:'Test',SOURCE_URL:'https://source.example/live/index.m3u8'});
 const markup=await response.text(),script=[...markup.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
 const instances=[],timers=new Map(),intervals=new Map(),events={},messages=[];let next=0,plays=0,loads=0,now=100000;
 const emit=name=>(events[name]||[]).forEach(fn=>fn());
 const video={
  paused:true,seeking:false,readyState:0,currentTime:0,
  pause(){this.paused=true;emit('pause');},removeAttribute(){},load(){loads++;},
  play(){plays++;if(this.paused){this.paused=false;emit('play');}return Promise.resolve();},
  canPlayType(){return 'probably';},addEventListener(name,fn){(events[name]??=[]).push(fn);}
 };
 const message={hidden:false,textContent:'',dataset:{},append(){}};
 class FakeHls{
  static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
  static ErrorTypes={NETWORK_ERROR:'networkError',MEDIA_ERROR:'mediaError'};
  static isSupported(){return hlsSupported;}
  constructor(config){this.config=config;this.handlers={};this.downloads=[];this.sources=[];this.destroyed=false;this.mediaRecoveries=0;instances.push(this);}
  on(name,callback){this.handlers[name]=callback;}
  loadSource(source){this.source=source;this.sources.push(source);}
  attachMedia(media){this.media=media;}
  startLoad(...args){this.downloads.push(args);}
  recoverMediaError(){this.mediaRecoveries++;video.pause();emit('canplay');}
  destroy(){this.destroyed=true;}
 }
 class Clock extends Date{static now(){return now;}}
 const context=vm.createContext({URL,Date:Clock,Hls:FakeHls,window:{Hls:FakeHls},parent:{postMessage:m=>messages.push(m)},
  location:{href:'https://camera.example/?parent=https://grid.example'},document:{getElementById:id=>id==='video'?video:message,createElement:()=>({})},
  setInterval(fn,delay){const id=++next;intervals.set(id,{fn,delay,at:now+delay});return id;},
  setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);}});
 vm.runInContext(script,context);
 function advance(ms){
  const end=now+ms;
  while(true){
   const pending=[...timers.entries()].map(([id,t])=>({id,...t,interval:false})).concat([...intervals.entries()].map(([id,t])=>({id,...t,interval:true}))).filter(t=>t.at<=end).sort((a,b)=>a.at-b.at);
   if(!pending.length)break;
   const t=pending[0];now=t.at;
   if(t.interval)intervals.get(t.id).at+=t.delay;else timers.delete(t.id);
   t.fn();
  }
  now=end;
 }
 function progress(seconds=1){video.currentTime+=seconds;video.readyState=4;video.paused=false;emit('timeupdate');}
 function fatal(type='networkError',code=502){instances.at(-1).handlers.error(null,{fatal:true,type,response:{code}});}
 return {video,message,instances,timers,messages,emit,advance,progress,fatal,get plays(){return plays;},get loads(){return loads;}};
}

test('Safari with MSE uses HLS.js and keeps the iPad playback attributes',async()=>{
 const h=await playerHarness();assert.equal(h.instances.length,1);assert.equal(h.video.src,undefined);
 const player=h.instances[0];assert.equal(new URL(player.source).pathname,'/hls/index.m3u8');assert.equal(player.media,h.video);
 player.handlers.manifest();assert.equal(h.plays,1);assert.equal(h.video.muted,true);assert.equal(h.video.playsInline,true);
});

test('native-only fallback keeps the absolute m3u8 URL',async()=>{
 const h=await playerHarness(false);assert.equal(h.instances.length,0);
 const source=new URL(h.video.src);assert.equal(source.origin,'https://camera.example');assert.equal(source.pathname,'/hls/index.m3u8');
 assert.equal(source.searchParams.get('url'),'https://source.example/live/index.m3u8');assert.equal(h.plays,1);
});

test('short buffering at segment boundaries keeps the last frame and does not relaunch',async()=>{
 const h=await playerHarness();h.instances[0].handlers.manifest();h.progress();const messageCount=h.messages.length;
 for(let i=0;i<8;i++){h.emit('waiting');h.advance(1000);h.progress(5);h.advance(4000);}
 assert.equal(h.instances.length,1);assert.equal(h.loads,1);assert.equal(h.message.hidden,true);
 assert.equal(h.messages.length,messageCount,'unchanged live state must not flood parent UI');
 h.emit('waiting');h.advance(1600);assert.equal(h.message.dataset.state,'buffering');assert.equal(h.instances.length,1);
 h.progress();assert.equal(h.message.hidden,true);
});

test('fatal network interruption retries downloads without clearing buffered video or seeking',async()=>{
 const h=await playerHarness();const player=h.instances[0];player.handlers.manifest();h.progress(20);
 h.fatal();h.advance(4000);
 assert.deepEqual(player.downloads,[[-1,true]]);assert.equal(player.destroyed,false);assert.equal(h.loads,1);assert.equal(h.video.currentTime,20);
 h.progress();h.fatal();h.advance(8000);assert.equal(player.downloads.length,2);assert.equal(h.instances.length,1);
});

test('media recovery is throttled and recovers the existing player',async()=>{
 const h=await playerHarness();const player=h.instances[0];player.handlers.manifest();h.progress();
 h.fatal('mediaError');h.advance(4000);assert.equal(player.mediaRecoveries,1);
 h.progress();h.fatal('mediaError');h.advance(8000);assert.equal(player.mediaRecoveries,1,'must not repeat decoder recovery after eight seconds');
 h.advance(22000);assert.equal(player.mediaRecoveries,2);assert.equal(player.destroyed,false);assert.equal(h.loads,1);
});

test('watchdog waits 90 seconds without progress before fully restarting, and respects pause',async()=>{
 const h=await playerHarness();h.instances[0].handlers.manifest();h.progress();
 h.advance(85000);assert.equal(h.instances.length,1);assert.equal(h.loads,1);
 h.advance(10000);assert.equal(h.instances.length,2);assert.equal(h.loads,2);
 const paused=await playerHarness();paused.instances[0].handlers.manifest();paused.progress();paused.video.pause();paused.advance(120000);assert.equal(paused.instances.length,1);
});

test('offline manifests retry on the same instance and denied access cancels all retries',async()=>{
 const h=await playerHarness();const player=h.instances[0];
 for(let i=0;i<6;i++){h.fatal();const t=[...h.timers.values()].sort((a,b)=>a.at-b.at)[0];assert.ok(t);h.advance(Math.min(60000,4000*2**i));}
 h.fatal('networkError',403);assert.match(h.message.textContent,/denied/);assert.equal(h.timers.size,0);
 const count=h.instances.length;h.advance(180000);assert.equal(h.instances.length,count);
 assert.ok(player.sources.length>1);
});
