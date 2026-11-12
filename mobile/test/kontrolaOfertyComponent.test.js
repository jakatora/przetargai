import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { podsumujKontrole } from '../src/lib/kontrolaOferty.js';
const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/screens/KontrolaOfertyScreen.js',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',loader:{'.js':'jsx'},jsxFactory:'h',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.kind==='entry-point'?null:{path:a.path,external:true});}}]});
function screen({read=async()=>new Set(),save=async()=>{}}={}) {
 const slots=[],effects=[],cleanups=[],writes=[];let cursor=0;
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();const cleanup=fn();slots[i]={deps,cleanup};cleanups[i]=cleanup;});},
 };
 const modules={react:hooks,'react-native':{View:'View',Text:'Text',Pressable:'Pressable',ActivityIndicator:'ActivityIndicator'},'../context/ThemeContext':{useTheme:()=>({kolory:{}}),useStyle:()=>({}),tworzStyle:f=>f},'../context/JezykContext':{useJezyk:()=>({t:pl=>pl})},'../theme':{spacing:{},radius:{}},'../lib/storage':{},'../lib/kontrolaOferty':{podsumujKontrole,wczytajKontroleOferty:(_s,id,options)=>read(id,options),zapiszKontroleOferty:(_s,id,value)=>{writes.push({id,value:[...value]});return save(id,value);}}};
 const module={exports:{}};vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,Set,React:{Fragment:'Fragment'},h:(type,props,...children)=>({type,props:props||{},children}),require:n=>modules[n]||{__esModule:true,default:n.split('/').at(-1)}});
 return {render(){cursor=0;const view=module.exports.KontrolaOfertyContent({route:{params:{match:{tender:{id:'A'}}}}});while(effects.length)effects.shift()();return view;},unmount(){cleanups.forEach(f=>f?.());},writes,wrapperMatch:match=>module.exports.default({route:{params:{match}}}),wrapper:id=>module.exports.default({route:{params:{match:{tender:{id}}}}})};
}
function find(n,p){if(!n||typeof n!=='object')return;if(Array.isArray(n)){for(const c of n){const r=find(c,p);if(r)return r;}return;}if(p(n))return n;return find(n.children,p);}
const tick=()=>new Promise(r=>setImmediate(r));
const checkbox=s=>find(s.render(),n=>n.props.accessibilityRole==='checkbox');
const alert=s=>find(s.render(),n=>n.props.accessibilityRole==='alert');
async function ready(s){s.render();await tick();s.render();}
test('failed write keeps confirmed checkbox and exposes a retry path',async()=>{
 let fail=true;const s=screen({save:async()=>{if(fail)throw Error('disk');}});await ready(s);
 await checkbox(s).props.onPress();assert.equal(checkbox(s).props.accessibilityState.checked,false);assert.ok(alert(s));
 fail=false;await checkbox(s).props.onPress();assert.equal(checkbox(s).props.accessibilityState.checked,true);assert.equal(s.writes.length,2);assert.equal(alert(s),undefined);
});
test('pending write does not mark completed and rapid taps cannot race storage',async()=>{
 let done;const s=screen({save:()=>new Promise(r=>{done=r;})});await ready(s);
 const click=checkbox(s).props.onPress;const first=click();await click();assert.equal(s.writes.length,1);assert.equal(checkbox(s).props.accessibilityState.checked,false);assert.equal(checkbox(s).props.disabled,true);
 done();await first;assert.equal(checkbox(s).props.accessibilityState.checked,true);
});
test('read failure blocks editing and retry restores confirmed data',async()=>{
 let fail=true;const s=screen({read:async(_id,options)=>{assert.equal(options.strict,true);if(fail)throw Error('disk');return new Set(['podpis']);}});await ready(s);
 assert.equal(checkbox(s),undefined);assert.ok(alert(s));fail=false;find(s.render(),n=>n.props.accessibilityRole==='button').props.onPress();await ready(s);assert.equal(checkbox(s).props.accessibilityState.checked,true);
});
test('tender switch remounts checklist and file report state',()=>{
 const s=screen();assert.notEqual(s.wrapper('A').props.key,s.wrapper('B').props.key);
});
test('late save after leaving cannot change abandoned UI',async()=>{
 let done;const s=screen({save:()=>new Promise(r=>{done=r;})});await ready(s);const pending=checkbox(s).props.onPress();s.unmount();done();await pending;assert.equal(checkbox(s).props.accessibilityState.checked,false);
});


test('legacy tender_id scopes checklist independently without nested tender id',()=>{
 const s=screen();assert.equal(s.wrapperMatch({tender_id:'legacy-A'}).props.key,'legacy-A');assert.equal(s.wrapperMatch({tender_id:'legacy-B'}).props.key,'legacy-B');
});
