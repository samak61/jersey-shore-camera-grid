// Shared source, deployed as a separate Worker for each camera.
const HLS_LIBRARY='https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
// Match the request settings in the owner's working sea-girt-north1 Worker.
const UPSTREAM_HEADERS={
 'Referer':'https://coastalcameranetwork.com/',
 'Origin':'https://coastalcameranetwork.com',
 'User-Agent':'Mozilla/5.0 (AppleTV; tvOS) AppleWebKit/605.1.15 (KHTML, like Gecko)',
 'Accept':'*/*'
};
function scope(env){const source=new URL(env.SOURCE_URL);return {source,origin:source.origin,prefix:source.pathname.slice(0,source.pathname.lastIndexOf('/')+1)};}
function allowed(value,env){try{const u=new URL(value),s=scope(env);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.origin===s.origin&&u.pathname.startsWith(s.prefix);}catch{return false;}}
function relay(value,base,env,workerURL){const u=new URL(value,base);if(!allowed(u.href,env))throw Error('Playlist references an unconfigured source.');const name=u.pathname.slice(u.pathname.lastIndexOf('/')+1)||'index.m3u8';const proxy=new URL('/hls/'+encodeURIComponent(name),workerURL);proxy.searchParams.set('url',u.href);return proxy.href;}
function rewritePlaylist(text,base,env,workerURL){return text.split(/\r?\n/).map(line=>{if(!line.trim())return line;if(line[0]!=='#')return relay(line.trim(),base,env,workerURL);return line.replace(/URI="([^"]+)"/g,(_m,uri)=>`URI="${relay(uri,base,env,workerURL)}"`);}).join('\n');}
function plain(message,status=200){return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}
function html(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function player(request,env){
 const url=new URL(request.url),requested=url.searchParams.get('url')||env.SOURCE_URL;if(!allowed(requested,env))return plain('This Worker is configured for one camera only.',403);
 const title=html(env.CAMERA_NAME||'Beach camera');const src=JSON.stringify(relay(requested,requested,env,request.url)).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#05090c;color:#d8e5eb;font:13px system-ui}video{display:block;width:100%;height:100%;object-fit:contain}#message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;background:#091217dc;line-height:1.6}#message[hidden]{display:none}#message[data-state="buffering"]{inset:auto 8px 8px auto;padding:5px 9px;border-radius:5px;font-size:12px;background:#091217bb}button{padding:9px 15px;border-radius:6px;border:0;background:#9ce4cf;color:#143b30;cursor:pointer}</style><script src="${HLS_LIBRARY}"></script></head><body><video id="video" autoplay muted playsinline disableremoteplayback controls></video><div id="message">Connecting ${title}…</div><script>
const source=${src},v=document.getElementById('video'),m=document.getElementById('message');
v.muted=true;v.defaultMuted=true;v.playsInline=true;v.disableRemotePlayback=true;
let hls=null,retry=null,waitingTimer=null,attempt=0,lastProgress=Date.now(),lastTime=-1;
let blocked=false,stopped=false,generation=0,userPaused=false,liveSince=0,hasPlayed=false,hasManifest=false;
let lastMediaRecovery=-Infinity,internalPauseUntil=0,lastState='',lastMessage='',nextRestart=0;
let parentOrigin='';try{const requestedParent=new URL(location.href).searchParams.get('parent');if(requestedParent)parentOrigin=new URL(requestedParent).origin;}catch{}
function state(value,message=''){
 if(value===lastState&&message===lastMessage)return;
 lastState=value;lastMessage=message;m.dataset.state=value;m.hidden=value==='live';
 if(!m.hidden)m.textContent=message||({connecting:'Connecting…',buffering:'Buffering…',ready:'Tap to play',retry:'Reconnecting…',error:'Camera unavailable',blocked:'The camera provider denied this request.'}[value]||value);
 if(parentOrigin&&parent!==window)parent.postMessage({type:'beach-camera-state',state:value,message},parentOrigin);
}
function clear(){
 stopped=true;generation++;clearTimeout(retry);retry=null;clearTimeout(waitingTimer);waitingTimer=null;
 if(hls){hls.destroy();hls=null;}v.pause();v.removeAttribute('src');v.load();
}
function play(){
 const g=generation;
 v.play().catch(e=>{if(g!==generation)return;if(e.name==='NotAllowedError'){
  state('ready');m.textContent='';const b=document.createElement('button');b.textContent='Play camera';
  b.onclick=()=>{userPaused=false;stopped=false;lastProgress=Date.now();play();};m.append(b);stopped=true;
 }});
}
// Retry downloads in place: keep decoded/buffered video instead of destroying it.
function recover(message,kind='network'){
 if(retry||blocked||stopped||userPaused)return;
 attempt=Math.min(attempt+1,5);
 let delay=Math.min(60000,4000*2**(attempt-1));
 if(kind==='media')delay=Math.max(delay,30000-(Date.now()-lastMediaRecovery));
 if(!hls)delay=Math.max(delay,nextRestart-Date.now());
 state(hasPlayed?'buffering':'retry',message+' Retrying in '+Math.ceil(delay/1000)+' seconds.');
 const g=generation;
 retry=setTimeout(()=>{
  retry=null;if(g!==generation||blocked||stopped||userPaused)return;
  if(!hls){start();return;}
  if(kind==='media'){
   lastMediaRecovery=Date.now();internalPauseUntil=Date.now()+3000;
   hls.recoverMediaError();
  }else if(hasManifest){
   // skipSeekToStartPosition preserves the playback position on network recovery.
   hls.startLoad(-1,true);
  }else hls.loadSource(source);
 },delay);
}
function start(){
 clear();blocked=false;stopped=false;userPaused=false;lastProgress=Date.now();lastTime=-1;liveSince=0;hasPlayed=false;hasManifest=false;
 nextRestart=Date.now()+90000;state('connecting');const g=generation;
 if(window.Hls&&Hls.isSupported()){
  // Favor steady viewing over the smallest live delay, especially with nine decoders.
  hls=new Hls({capLevelToPlayerSize:true,ignoreDevicePixelRatio:true,capLevelOnFPSDrop:true,
   lowLatencyMode:false,maxBufferLength:30,maxMaxBufferLength:45,backBufferLength:10,
   maxBufferSize:18000000,liveSyncDurationCount:6,maxLiveSyncPlaybackRate:1,startLevel:0});
  hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(g!==generation)return;hasManifest=true;play();});
  hls.on(Hls.Events.ERROR,(_e,d)=>{
   if(g!==generation||stopped||!d.fatal)return;
   if(d.response?.code===401||d.response?.code===403){blocked=true;clear();state('blocked','The camera provider denied playback.');return;}
   recover('The camera connection was interrupted'+(d.response?.code?' (HTTP '+d.response.code+')':'' )+'.',d.type===Hls.ErrorTypes.MEDIA_ERROR?'media':'network');
  });
  hls.loadSource(source);hls.attachMedia(v);
 }else if(v.canPlayType('application/vnd.apple.mpegurl')){
  v.src=source;v.onloadedmetadata=()=>{if(g===generation)play();};play();
 }else{stopped=true;state('error','This browser could not load the video player.');}
}
v.addEventListener('timeupdate',()=>{
 if(stopped||v.seeking)return;
 if(v.currentTime!==lastTime&&v.readyState>=2){
  lastTime=v.currentTime;lastProgress=Date.now();hasPlayed=true;
  clearTimeout(waitingTimer);waitingTimer=null;
  if(!liveSince)liveSince=Date.now();if(Date.now()-liveSince>30000)attempt=0;
  state('live');
 }
});
v.addEventListener('waiting',()=>{
 if(stopped||userPaused||waitingTimer)return;
 liveSince=0;const g=generation;
 // Brief segment-boundary pauses must not flash a full-screen overlay.
 waitingTimer=setTimeout(()=>{waitingTimer=null;if(g===generation&&!stopped&&!userPaused)state('buffering');},1500);
});
v.addEventListener('canplay',()=>{if(!stopped&&!userPaused&&v.paused)play();});
v.addEventListener('pause',()=>{if(!stopped&&Date.now()>=internalPauseUntil)userPaused=true;});
v.addEventListener('play',()=>{userPaused=false;lastProgress=Date.now();});
v.addEventListener('error',()=>{if(!hls&&!stopped)recover('The source could not be loaded.');});
setInterval(()=>{
 if(stopped||userPaused||blocked)return;
 const stalled=Date.now()-lastProgress;
 // A full restart is a last resort after 90 seconds without video, never every few seconds.
 if(stalled>90000&&Date.now()>=nextRestart){start();return;}
 if(stalled>45000&&!retry)recover('Waiting for fresh video.');
},5000);
start();
</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff'}});
}
async function stream(request,env){
 const source=new URL(request.url).searchParams.get('url')||env.SOURCE_URL;if(!allowed(source,env))return plain('This Worker is configured for one camera only.',403);
 const headers=new Headers(UPSTREAM_HEADERS);const range=request.headers.get('Range');if(range&&/^bytes=\d+-\d*$/.test(range))headers.set('Range',range);
 // Apply the same headers to playlists, keys and media segments.
 let upstream;try{upstream=await fetch(source,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{return plain('The upstream camera could not be reached.',502);}
 if(upstream.status===401||upstream.status===403){upstream.body?.cancel();return plain('The upstream camera denied access.',upstream.status);}
 if(upstream.status>=300&&upstream.status<400){const target=new URL(upstream.headers.get('Location')||'',source);upstream.body?.cancel();if(!allowed(target.href,env))return plain('The camera redirected outside its configured source.',502);return new Response(null,{status:302,headers:{Location:relay(target.href,source,env,request.url),'Cache-Control':'no-store'}});}
 if(!upstream.ok){upstream.body?.cancel();return plain('The camera returned HTTP '+upstream.status+'.',upstream.status);}
 const type=upstream.headers.get('Content-Type')||'';
 if(new URL(source).pathname.endsWith('.m3u8')||/mpegurl/i.test(type)){const text=await upstream.text();if(text.length>1000000||!text.trimStart().startsWith('#EXTM3U'))return plain('The source did not return an HLS playlist.',502);try{return new Response(rewritePlaylist(text,source,env,request.url),{headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}catch{return plain('The playlist references a source that is not configured for this camera.',502);}}
 const extension=new URL(source).pathname.split('.').pop().toLowerCase();const mediaType=({ts:'video/mp2t',mp4:'video/mp4',m4s:'video/iso.segment',aac:'audio/aac',mp3:'audio/mpeg',vtt:'text/vtt'})[extension]||type||'application/octet-stream';
 const outputHeaders=new Headers({'Content-Type':mediaType,'Cache-Control':'private, max-age=15','Access-Control-Allow-Origin':'*'});for(const name of ['Content-Length','Content-Range','Accept-Ranges'])if(upstream.headers.has(name))outputHeaders.set(name,upstream.headers.get(name));return new Response(upstream.body,{status:upstream.status,headers:outputHeaders});
}
export default {async fetch(request,env){if(request.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'}});if(!['GET','HEAD'].includes(request.method))return plain('Method not allowed.',405);if(!env.SOURCE_URL)return plain('Configure SOURCE_URL for this camera Worker.',503);const path=new URL(request.url).pathname;if(path==='/stream'||path.startsWith('/hls/'))return stream(request,env);if(path==='/')return player(request,env);return plain('Not found.',404);}};
