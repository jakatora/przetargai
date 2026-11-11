import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import * as rules from '../src/lib/zapytajSwz.js';

const bundle = await build({
  entryPoints:[fileURLToPath(new URL('../src/components/ZapytajSwz.js',import.meta.url))],
  bundle:true,write:false,format:'cjs',platform:'node',loader:{'.js':'jsx'},jsxFactory:'h',
  plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.kind==='entry-point'?null:{path:a.path,external:true});}}],
});
function screen(send) {
  const slots=[], cleanups=[], writes=[]; let cursor=0;
  const hooks={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect(fn){const i=cursor++;if(!(i in slots)){slots[i]=true;cleanups.push(fn());}},
  };
  const modules={react:hooks,'react-native':{View:'View',Text:'Text',Pressable:'Pressable'},
    '../context/ThemeContext':{useStyle:()=>({}),tworzStyle:f=>f},
    '../context/JezykContext':{useJezyk:()=>({t:pl=>pl})},
    '../lib/zapytajSwz':rules,'../theme':{spacing:{},radius:{}},
    '../api/client':{api:{}},
  };
  const module={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,
    h:(type,props,...children)=>({type,props:props||{},children}),
    require:n=>modules[n]||{__esModule:true,default:n.split('/').at(-1)},
  });
  return {render(){cursor=0;return module.exports.default({postepowanieId:'A',trescSwz:{},zapytajFn:p=>{writes.push(p);return send(p);}});},
    unmount(){cleanups.forEach(fn=>fn?.());},writes};
}
function find(n,p){if(!n||typeof n!=='object')return;if(Array.isArray(n)){for(const c of n){const r=find(c,p);if(r)return r;}return;}if(p(n))return n;return find(n.children,p);}
const field=s=>find(s.render(),n=>n.type==='TextField');
const ask=s=>find(s.render(),n=>n.type==='Button');
const text=s=>JSON.stringify(s.render());
const answer={odpowiedz:'Odpowiedź A',status:'brak_w_swz',cytaty:[]};

test('two submissions in one render send one AI question',async()=>{
  let done;const response=new Promise(r=>{done=r;});const s=screen(()=>response);
  field(s).props.onChangeText('Czy jest wadium?');
  const submit=ask(s).props.onPress;const pending=submit();const second=submit();
  done(answer);await Promise.all([pending,second]);assert.equal(s.writes.length,1);
});
test('answer cannot erase a new draft typed while waiting',async()=>{
  let done;const s=screen(()=>new Promise(r=>{done=r;}));
  field(s).props.onChangeText('Czy jest wadium?');const pending=ask(s).props.onPress();
  field(s).props.onChangeText('Jaki termin?');done(answer);await pending;
  assert.equal(field(s).props.value,'Jaki termin?');
});
test('late response after leaving does not add an answer',async()=>{
  let done;const s=screen(()=>new Promise(r=>{done=r;}));
  field(s).props.onChangeText('Czy jest wadium?');const pending=ask(s).props.onPress();
  s.unmount();done(answer);await pending;assert.ok(!text(s).includes('Odpowiedź A'));
});
test('failure retains the question and permits an explicit retry',async()=>{
  let fail=true;const s=screen(async()=>{if(fail)throw Error('Brak połączenia');return answer;});
  field(s).props.onChangeText('Czy jest wadium?');await ask(s).props.onPress();
  assert.equal(field(s).props.value,'Czy jest wadium?');assert.ok(text(s).includes('Brak połączenia'));
  fail=false;await ask(s).props.onPress();assert.equal(s.writes.length,2);assert.ok(text(s).includes('Odpowiedź A'));
});
