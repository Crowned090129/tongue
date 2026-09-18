'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const babel = require('@babel/standalone');
const db = require('../db');
const content = require('../routes/content');
const billing = require('../routes/stripe');
const app = require('../app');
const { assertTestDatabase } = require('./support/assertTestDatabase');
let server, base, user;
const suffix = `${Date.now()}_${process.pid}`;
const token = claims => jwt.sign({ userId:user.id, plan:'free', ...claims }, process.env.JWT_SECRET);
const post = (route, claims, body) => fetch(base + route, {
  method:'POST', headers:{'Content-Type':'application/json', ...(claims ? {Authorization:'Bearer '+token(claims)} : {})},
  body:JSON.stringify(body || {})
});
before(async () => {
  await db.initialize();
  user = await db.get('INSERT INTO users(email,stripe_customer_id) VALUES($1,$2) RETURNING *', [`release_${suffix}@tongue-test.invalid`, `cus_${suffix}`]);
  await new Promise(resolve => { server=app.listen(0,'127.0.0.1',resolve); });
  base=`http://127.0.0.1:${server.address().port}`;
});
after(async () => { billing.__setStripeClientForTests(null); if(server) await new Promise(r=>server.close(r)); await db.pool.end(); });

test('all 84 bundled files satisfy their compatibility contract without mutation', () => {
  let count=0;
  for(const lang of content.VALID_LANGS) for(const tab of content.VALID_TABS) {
    const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../seed/content',lang,tab+'.json'),'utf8'));
    const before=JSON.stringify(data);
    assert.equal(content.validateContent(lang,tab,data,{bundledSeed:true}),null,`${lang}/${tab}`);
    assert.equal(JSON.stringify(data),before);
    count++;
  }
  assert.equal(count,84);
});

test('AI generation still requires enriched content; bundled compatibility rejects malformed material', () => {
  const grammar=structuredClone(require('../seed/content/fr/grammar.json'));
  const vocab=structuredClone(require('../seed/content/fr/vocab.json'));
  assert.match(content.validateContent('fr','grammar',grammar),/examples/);
  assert.match(content.validateContent('fr','vocab',vocab),/too few words/);
  grammar.sections[0].example_ref='';
  assert.match(content.validateContent('fr','grammar',grammar,{bundledSeed:true}),/example_ref/);
  vocab.categories[0].words[0].r='';
  assert.match(content.validateContent('fr','vocab',vocab,{bundledSeed:true}),/incomplete word/);
  assert.match(content.validateContent('fr','grammar',null,{bundledSeed:true}),/missing/);
});

test('frozen seeding preserves existing content bytes and fills missing lesson content', async () => {
  const before=await db.all('SELECT lang,tab,content_json FROM content_cache ORDER BY lang,tab');
  await content.seedContent();
  const rows=await db.all('SELECT lang,tab,content_json FROM content_cache ORDER BY lang,tab');
  assert.equal(rows.length,84);
  for(const old of before) assert.equal(rows.find(r=>r.lang===old.lang && r.tab===old.tab).content_json,old.content_json);
  for(const tab of ['grammar','vocab','dialogues']) {
    const res=await fetch(`${base}/api/content/fr/${tab}`,{headers:{Authorization:'Bearer '+token({verified:true})}});
    assert.equal(res.status,200);
    assert.deepEqual((await res.json()).content,require(`../seed/content/fr/${tab}.json`));
  }
});

test('malformed JSON fails honestly and leaves health endpoint alive', async () => {
  const res=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(res.status,400);
  assert.equal((await res.json()).code,'invalid_json');
  assert.equal((await fetch(base+'/health')).status,200);
});

test('billing refuses missing, unverified and legacy sessions before contacting Stripe', async () => {
  let calls=0;
  billing.__setStripeClientForTests(()=>({billingPortal:{sessions:{create:async()=>{calls++; return {url:'https://billing.stripe.com/p/session/test'};}}}}));
  assert.equal((await post('/api/stripe/create-portal')).status,401);
  for(const claims of [{verified:false},{}]) {
    const res=await post('/api/stripe/create-portal',claims,{email:'someone-else@example.invalid'});
    assert.equal(res.status,403);
    assert.equal((await res.json()).code,'verification_required');
  }
  assert.equal(calls,0);
});

test('verified billing uses only the signed-in customer, ignoring supplied identity', async () => {
  let customer;
  billing.__setStripeClientForTests(()=>({billingPortal:{sessions:{create:async args=>{customer=args.customer; return {url:'https://billing.stripe.com/p/session/test'};}}}}));
  const res=await post('/api/stripe/create-portal',{verified:true},{email:'someone-else@example.invalid',customer:'cus_other'});
  assert.equal(res.status,200);
  assert.equal(customer,user.stripe_customer_id);
});

test('database guard refuses remote, production-named and absent URLs', () => {
  assert.throws(()=>assertTestDatabase('postgres://test@remote.invalid/tongue_test'),/Refusing/);
  assert.throws(()=>assertTestDatabase('postgres://test@127.0.0.1/tongue_prod'),/Refusing/);
  assert.throws(()=>assertTestDatabase(''),/required/);
});

test('atomic rate limiter admits exactly five of twenty concurrent requests', async () => {
  const results=await Promise.all(Array.from({length:20},()=>db.hitRateLimit('release_'+suffix,5,60_000)));
  assert.equal(results.filter(r=>r.allowed).length,5);
});

test('unconfigured AI returns availability error and consumes no quota', async () => {
  const res=await post('/api/claude',{verified:true},{prompt:'Say hello',language:'fr',nativeLang:'en'});
  assert.equal(res.status,503);
  assert.equal((await res.json()).code,'ai_unconfigured');
  const quota=await db.get('SELECT count FROM rate_limits WHERE user_id=$1',[String(user.id)]);
  assert.equal(Number(quota?.count || 0),0);
});

const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const script=html.match(/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
test('entire browser client compiles',()=>assert.ok(babel.transform(script,{presets:['react']}).code));

test('review renders only the current language and respects persisted review dates',()=>{
  const now=Date.now();
  const cards=[
    {id:'a',lang:'fr',next_review:now-100,repetitions:0},
    {id:'b',lang:'fr',next_review:now+86400000,repetitions:2},
    {id:'c',lang:'es',next_review:now-100,repetitions:0}
  ];
  const context={Date, React:{createElement:(_tag,_props,...children)=>children},useLucide:()=>{},fcLoad:()=>cards,
    C:{},GRAD:'',t:x=>x,TARGETS:{fr:{name:'French'}},BackBtn:()=>{},Icon:()=>{}};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('function fcDeckStats('),script.indexOf('function SaveToFlashcardsBtn(')),context);
  const source=script.slice(script.indexOf('function ReviewScreen('),script.indexOf('// ── NEW ONBOARDING'));
  vm.runInContext(babel.transform(source,{presets:['react']}).code,context);
  const text=vm.runInContext('ReviewScreen({nav:()=>{},goBack:()=>{},tLang:"fr"})',context).flat(Infinity).filter(x=>x!=null).join('');
  assert.match(text,/1 card due/);
  assert.match(text,/2 cards · 1 due · 1 upcoming/);
  assert.match(text,/1 cards/);
  assert.equal(cards[1].next_review,now+86400000);
});

test('corrupt persisted content returns an error rather than substituting a different lesson', async () => {
  const old=await db.get("SELECT content_json FROM content_cache WHERE lang='fr' AND tab='grammar'");
  try {
    await db.run("UPDATE content_cache SET content_json='invalid-json' WHERE lang='fr' AND tab='grammar'");
    const res=await fetch(base+'/api/content/fr/grammar',{headers:{Authorization:'Bearer '+token({verified:true})}});
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'content_corrupt');
    assert.equal((await db.get("SELECT content_json FROM content_cache WHERE lang='fr' AND tab='grammar'")).content_json,'invalid-json');
  } finally {
    await db.run("UPDATE content_cache SET content_json=$1 WHERE lang='fr' AND tab='grammar'",[old.content_json]);
  }
});

test('dialog handles Escape after a disabled action loses focus, traps Tab, and restores focus', () => {
  let listener, cleanup, closed=0, restored=0;
  const first={getClientRects:()=>[1],focus:()=>{doc.activeElement=first;}};
  const last={getClientRects:()=>[1],focus:()=>{doc.activeElement=last;}};
  const dialog={querySelectorAll:()=>[first,last],contains:el=>[first,last].includes(el)};
  const previous={isConnected:true,focus:()=>{restored++;}};
  const doc={activeElement:previous,addEventListener:(_name,fn)=>{listener=fn;},removeEventListener:()=>{listener=null;}};
  const context={document:doc,useRef:value=>({current:value===null?dialog:value}),useEffect:fn=>{cleanup=fn();}};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('function useDialog('),script.indexOf('// ── SETTINGS OVERLAY')),context);
  context.useDialog(()=>closed++);
  assert.equal(doc.activeElement,first);
  listener({key:'Tab',shiftKey:true,preventDefault(){}});
  assert.equal(doc.activeElement,last);
  doc.activeElement={}; // disabling the submit button can move focus to body
  listener({key:'Escape',preventDefault(){}});
  assert.equal(closed,1);
  cleanup(); assert.equal(restored,1); assert.equal(listener,null);
});

test('rating schedules review without changing card identity or the original card', () => {
  const context={Date}; vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('function sm2('),script.indexOf('// One source for deck numbers')),context);
  const card={id:'saved-card',lang:'fr',front:'le pain',back:'bread',interval:1,repetitions:0,ease:2.5,next_review:0};
  const before=JSON.stringify(card), start=Date.now();
  const result=context.sm2(card,2);
  assert.equal(result.id,card.id); assert.equal(result.repetitions,1);
  assert.ok(result.next_review >= start+86400000);
  assert.equal(JSON.stringify(card),before);
});

test('guided practice retains paired material and requires every round before completion',()=>{
  let states=[], cursor=0, completed=0, saved=[];
  const context={React:{createElement:(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)})},
    useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useLucide:()=>{},C:{},TARGETS:{fr:{name:'French'}},lpTitle:()=> 'Test lesson',PlayBtn:()=>{},VocabLesson:()=>{},GrammarLesson:()=>{},DialogueLesson:()=>{},Info:()=>{},fcAdd:card=>{saved.push(card);return true;}};
  vm.createContext(context);
  vm.runInContext(babel.transform(script.slice(script.indexOf('function lessonPracticeItems('),script.indexOf('const LESSON_KIND')),{presets:['react']}).code,context);
  const words=Array.from({length:12},(_,i)=>({t:'word'+i,r:'meaning'+i}));
  const data={vocab:[{words}],grammar:[{example_target:'one',example_target_2:'two',example_ref:'both translations',rule:'rule'}],dialogues:[{scene:'scene',lines:[{target:'hello',ref:'greeting'},{target:'reply',ref:'response'}]}]};
  assert.equal(context.lessonPracticeItems({kind:'grammar',idx:0},data)[0].target,'one two');
  assert.equal(context.lessonPracticeItems({kind:'dialogue',idx:0},data)[1].note,'hello');
  const props={lesson:{id:'v0',kind:'vocab',idx:0},d:data,tLang:'fr',onNext:()=>completed++,onClose:()=>{},hasNext:true};
  function render(){cursor=0;return context.LessonView(props);}
  function nodes(node){return node&&typeof node==='object'?[node,...node.children.flatMap(nodes)]:[];}
  function label(node){return node.children.map(c=>typeof c==='object'?'':String(c)).join('');}
  function click(name){const button=nodes(render()).find(n=>n.tag==='button'&&label(n)===name);assert.ok(button,'button '+name);button.props.onClick();}
  for(let round=0;round<3;round++){
    const length=round===2?2:5;
    for(let i=0;i<length-1;i++)click('Next example');
    click('Ready to try from memory');
    assert.equal(nodes(render()).some(n=>n.tag==='button'&&label(n)==='Finish lesson & continue'),false);
    for(let i=0;i<length;i++){click('Compare with the example');click(i===0?'I need another try':'I recalled it');}
    click('Save this round for review');
    assert.equal(completed,0);
    click(round===2?'Finish lesson & continue':'Next short round');
  }
  assert.equal(completed,1);
  assert.equal(saved.length,12);
  assert.equal(new Set(saved.map(c=>c.front)).size,12);
  assert.ok(saved.every(c=>c.lang==='fr'));
  assert.deepEqual(words, data.vocab[0].words);
});
