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
function relay(value,base,env){const u=new URL(value,base).href;if(!allowed(u,env))throw Error('Playlist references an unconfigured source.');return '/stream?url='+encodeURIComponent(u);}
function rewritePlaylist(text,base,env){return text.split(/\r?\n/).map(line=>{if(!line.trim())return line;if(line[0]!=='#')return relay(line.trim(),base,env);return line.replace(/URI="([^"]+)"/g,(_m,uri)=>`URI="${relay(uri,base,env)}"`);}).join('\n');}
function plain(message,status=200){return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}
function html(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function player(request,env){
 const url=new URL(request.url),requested=url.searchParams.get('url')||env.SOURCE_URL;if(!allowed(requested,env))return plain('This Worker is configured for one camera only.',403);
 const title=html(env.CAMERA_NAME||'Beach camera');const src=JSON.stringify('/stream?url='+encodeURIComponent(requested)).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;background:#05090c;color:#d8e5eb;font:13px system-ui}video{width:100%;height:100%;object-fit:contain}#message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;background:#091217dc;line-height:1.6}#message[hidden]{display:none}button{padding:9px 15px;border-radius:6px;border:0;background:#9ce4cf;color:#143b30;cursor:pointer}</style><script src="${HLS_LIBRARY}"></script></head><body><video id="video" autoplay muted playsinline controls></video><div id="message">Connecting ${title}…</div><script>
const source=${src},v=document.getElementById('video'),m=document.getElementById('message');
let hls=null,retry=null,attempt=0,lastProgress=Date.now(),lastTime=-1,blocked=false,stopped=false,generation=0,userPaused=false,liveSince=0;
let parentOrigin='';try{const requestedParent=new URL(location.href).searchParams.get('parent');if(requestedParent)parentOrigin=new URL(requestedParent).origin;}catch{}
function state(value,message=''){m.hidden=value==='live';if(!m.hidden)m.textContent=message||({connecting:'Connecting…',buffering:'Buffering…',ready:'Tap to play',retry:'Reconnecting…',error:'Camera unavailable',blocked:'The camera provider denied this request.'}[value]||value);if(parentOrigin&&parent!==window)parent.postMessage({type:'beach-camera-state',state:value,message},parentOrigin);}
function clear(){stopped=true;generation++;clearTimeout(retry);retry=null;if(hls){hls.destroy();hls=null;}v.pause();v.removeAttribute('src');v.load();}
function play(){const g=generation;v.play().catch(e=>{if(g!==generation)return;if(e.name==='NotAllowedError'){state('ready');m.textContent='';const b=document.createElement('button');b.textContent='Play camera';b.onclick=()=>{userPaused=false;stopped=false;lastProgress=Date.now();play();};m.append(b);stopped=true;}});}
function recover(message){if(retry||blocked)return;clear();if(++attempt>5){state('error',message+' Reload this camera to try again.');return;}const delay=Math.min(60000,4000*2**(attempt-1));state('retry',message+' Retrying in '+delay/1000+' seconds.');retry=setTimeout(()=>{retry=null;start();},delay);}
function start(){clear();blocked=false;stopped=false;userPaused=false;lastProgress=Date.now();lastTime=-1;liveSince=0;state('connecting');const g=generation;
if(v.canPlayType('application/vnd.apple.mpegurl')&&(!window.Hls||!Hls.isSupported()||(/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent)))){v.src=source;v.onloadedmetadata=()=>{if(g===generation)play();};play();}
else if(window.Hls&&Hls.isSupported()){hls=new Hls({capLevelToPlayerSize:true,maxBufferLength:10,maxMaxBufferLength:20,backBufferLength:0,maxBufferSize:12000000,liveSyncDurationCount:3});hls.on(Hls.Events.MANIFEST_PARSED,play);hls.on(Hls.Events.ERROR,(_e,d)=>{if(g!==generation||!d.fatal)return;if(d.response?.code===401||d.response?.code===403){blocked=true;clear();state('blocked','The camera provider denied playback.');return;}recover('The camera connection failed'+(d.response?.code?' (HTTP '+d.response.code+')':'')+'.');});hls.loadSource(source);hls.attachMedia(v);}else state('error','This browser could not load the video player.');}
v.addEventListener('timeupdate',()=>{if(stopped)return;if(v.currentTime!==lastTime&&v.readyState>=2){lastTime=v.currentTime;lastProgress=Date.now();if(!liveSince)liveSince=Date.now();if(Date.now()-liveSince>30000)attempt=0;state('live');}});
v.addEventListener('waiting',()=>{if(!stopped){liveSince=0;state('buffering');}});
v.addEventListener('pause',()=>{if(!stopped)userPaused=true;});v.addEventListener('play',()=>{userPaused=false;lastProgress=Date.now();});
v.addEventListener('error',()=>{if(!hls&&!stopped)recover('The source could not be loaded.');});
setInterval(()=>{if(!stopped&&!userPaused&&!retry&&!blocked&&Date.now()-lastProgress>35000)recover('No new video has arrived.');},5000);
start();
</script></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff'}});
}
async function stream(request,env){
 const source=new URL(request.url).searchParams.get('url')||env.SOURCE_URL;if(!allowed(source,env))return plain('This Worker is configured for one camera only.',403);
 const headers=new Headers(UPSTREAM_HEADERS);const range=request.headers.get('Range');if(range&&/^bytes=\d+-\d*$/.test(range))headers.set('Range',range);
 // Apply the same headers to playlists, keys and media segments.
 let upstream;try{upstream=await fetch(source,{headers,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{return plain('The upstream camera could not be reached.',502);}
 if(upstream.status===401||upstream.status===403){upstream.body?.cancel();return plain('The upstream camera denied access.',upstream.status);}
 if(upstream.status>=300&&upstream.status<400){const target=new URL(upstream.headers.get('Location')||'',source);upstream.body?.cancel();if(!allowed(target.href,env))return plain('The camera redirected outside its configured source.',502);return new Response(null,{status:302,headers:{Location:relay(target.href,source,env),'Cache-Control':'no-store'}});}
 if(!upstream.ok){upstream.body?.cancel();return plain('The camera returned HTTP '+upstream.status+'.',upstream.status);}
 const type=upstream.headers.get('Content-Type')||'';
 if(new URL(source).pathname.endsWith('.m3u8')||/mpegurl/i.test(type)){const text=await upstream.text();if(text.length>1000000||!text.trimStart().startsWith('#EXTM3U'))return plain('The source did not return an HLS playlist.',502);try{return new Response(rewritePlaylist(text,source,env),{headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});}catch{return plain('The playlist references a source that is not configured for this camera.',502);}}
 const outputHeaders=new Headers({'Content-Type':type||'application/octet-stream','Cache-Control':'private, max-age=15','Access-Control-Allow-Origin':'*'});for(const name of ['Content-Length','Content-Range','Accept-Ranges'])if(upstream.headers.has(name))outputHeaders.set(name,upstream.headers.get(name));return new Response(upstream.body,{status:upstream.status,headers:outputHeaders});
}
export default {async fetch(request,env){if(request.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Range'}});if(!['GET','HEAD'].includes(request.method))return plain('Method not allowed.',405);if(!env.SOURCE_URL)return plain('Configure SOURCE_URL for this camera Worker.',503);const path=new URL(request.url).pathname;if(path==='/stream')return stream(request,env);if(path==='/')return player(request,env);return plain('Not found.',404);}};
