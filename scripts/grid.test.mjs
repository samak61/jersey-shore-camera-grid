import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function grid(search='?mode=light'){
 const elements=new Map(),timers=new Map();let id=0;
 function element(){const children=new Map();return {dataset:{},classList:{add(){},remove(){}},setAttribute(){},append(){},replaceChildren(){},querySelector(selector){if(!children.has(selector))children.set(selector,element());return children.get(selector);}};}
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,addEventListener(){}};
 const context=vm.createContext({document,window:{CAMERA_DEFAULTS:Array.from({length:9},(_,i)=>({name:'Camera '+i,url:'https://camera'+i+'.example/'})),addEventListener(){}},navigator:{userAgent:'iPad'},location:{search,href:'https://example.com/'+search,origin:'https://example.com'},history:{replaceState(){}},localStorage:{getItem(){return null;}},structuredClone,URL,URLSearchParams,Intl,Date,setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(){}});
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
 return {run:s=>vm.runInContext(s,context),flush(){for(const [id,t] of [...timers])if(t.delay<2000){timers.delete(id);t.fn();}}};
}
test('iPad starts three Sea Girt tiles; manually playing another unloads an old player',()=>{
 const g=grid('');g.flush();assert.equal(g.run("players.filter(p=>!p.paused).length"),3);
 assert.equal(g.run("players.flatMap((p,i)=>p.paused?[]:[i]).join(',')"),'4,5,6');
 g.run("players[0].setPaused(false)");assert.equal(g.run("players.filter(p=>!p.paused).length"),3);assert.equal(g.run("players[4].frame.src"),'about:blank');
 g.run("$('reload-all').onclick()");g.flush();assert.equal(g.run("players.filter(p=>!p.paused).length"),3);
});
test('pause all cancels pending starts; mode switch explicitly enables nine',()=>{
 const g=grid();g.run("players[4].setPaused(false);$('play-all').onclick()");g.flush();
 assert.equal(g.run("players.filter(p=>!p.paused).length"),0);
 g.run("$('play-all').onclick()");g.flush();assert.equal(g.run("players.filter(p=>!p.paused).length"),1);
 g.run("$('mode').onclick()");g.flush();
 // Remaining staggered starts have delays between two and four seconds.
 g.run("players.forEach(p=>p.setPaused(false))");
 assert.equal(g.run("players.filter(p=>!p.paused).length"),9);
 g.run("$('mode').onclick()");g.flush();assert.equal(g.run("players.filter(p=>!p.paused).length"),3);
});
