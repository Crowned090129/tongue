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
  for(const claims of [{verified:false,signupOwner:true}]) {
    const res=await post('/api/stripe/create-portal',claims,{email:'someone-else@example.invalid'});
    assert.equal(res.status,403);
    assert.equal((await res.json()).code,'verification_required');
  }
  assert.equal((await post('/api/stripe/create-portal',{})).status,401);
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
    useEffect:()=>{},learnerGet:()=>null,learnerSet:()=>{},learnerKey:k=>k,localStorage:{removeItem:()=>{}},useLucide:()=>{},C:{},TARGETS:{fr:{name:'French'}},lpTitle:()=> 'Test lesson',PlayBtn:()=>{},VocabLesson:()=>{},GrammarLesson:()=>{},DialogueLesson:()=>{},Info:()=>{},fcAdd:card=>{saved.push(card);return true;}};
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

test('account status and legacy signup revocation apply on every authenticated route',async()=>{
  for(const claims of [{verified:false},{}]) assert.equal((await post('/api/auth/preferences',claims,{language:'fr'})).status,401);
  const res=await post('/api/auth/preferences',{verified:false,signupOwner:true},{language:'fr'});
  assert.equal(res.status,200);
  try {
    await db.run("UPDATE users SET status='suspended' WHERE id=$1",[user.id]);
    assert.equal((await post('/api/streaks/log',{verified:true})).status,403);
    assert.equal((await post('/api/auth/preferences',{verified:true},{language:'es'})).status,403);
    await db.run("UPDATE users SET status='deleted' WHERE id=$1",[user.id]);
    assert.equal((await post('/api/streaks/log',{verified:true})).status,401);
  } finally {await db.run("UPDATE users SET status='active' WHERE id=$1",[user.id]);}
});

test('concurrent signup issues exactly one session for a new email',async()=>{
  const email=`race_${suffix}@tongue-test.invalid`;
  const replies=await Promise.all(Array.from({length:4},()=>post('/api/auth/signup',null,{email})));
  assert.equal(replies.filter(r=>r.status===200).length,1);
  assert.equal(replies.filter(r=>r.status===409).length,3);
});

test('revoked paid nonce is rejected outside the startup validation endpoint',async()=>{
  const code=await db.get("INSERT INTO access_codes(user_id,code,expires_at,session_nonce) VALUES($1,$2,NOW()+INTERVAL '1 day','current') RETURNING id",[user.id,'NONCE_'+suffix]);
  assert.equal((await post('/api/auth/preferences',{verified:true,codeId:code.id,nonce:'old'},{language:'fr'})).status,401);
  assert.equal((await post('/api/auth/preferences',{verified:true,codeId:code.id,nonce:'current'},{language:'fr'})).status,200);
});

test('deletion fails closed when billing is not configured, retaining account and access',async()=>{
  const key=process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_SECRET_KEY;
  try {
    const res=await fetch(base+'/api/auth/account',{method:'DELETE',headers:{Authorization:'Bearer '+token({verified:true})}});
    assert.equal(res.status,503);
    assert.equal((await db.get('SELECT status FROM users WHERE id=$1',[user.id])).status,'active');
  } finally {if(key!==undefined)process.env.STRIPE_SECRET_KEY=key;}
});

test('browser learner storage isolates accounts and only migrates legacy data to its assigned owner',()=>{
  const data=new Map([['learner_legacy_owner','1'],['fc_cards_v2','legacy-one']]);
  let current=jwt.sign({userId:1},'test');
  const context={atob:x=>Buffer.from(x,'base64').toString('utf8'),getToken:()=>current,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('function learnerId('),script.indexOf('const FC_KEY')),context);
  assert.equal(context.learnerGet('fc_cards_v2'),'legacy-one');
  current=jwt.sign({userId:2},'test');
  assert.equal(context.learnerGet('fc_cards_v2'),null);
  context.learnerSet('fc_cards_v2','two');
  assert.equal(context.learnerGet('fc_cards_v2'),'two');
  current=jwt.sign({userId:1},'test');
  assert.equal(context.learnerGet('fc_cards_v2'),'legacy-one');
  assert.equal(data.get('fc_cards_v2'),'legacy-one');
});

test('failed magic-link delivery is reported honestly and the unsent link is invalidated',async()=>{
  const mail=require('../utils/email');const original=mail.sendEmail;mail.sendEmail=async()=>false;
  const email=`unsent_${suffix}@tongue-test.invalid`;
  try {
    const res=await post('/api/auth/magic-link/request',null,{email});
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'email_unavailable');
    assert.equal(Number((await db.get('SELECT COUNT(*) AS n FROM magic_links WHERE email=$1',[email])).n),0);
  } finally {mail.sendEmail=original;}
});

test('health refuses new traffic while the server is draining',async()=>{
  app.locals.draining=true;
  try {assert.equal((await fetch(base+'/health')).status,503);}
  finally {app.locals.draining=false;}
  assert.equal((await fetch(base+'/health')).status,200);
});

// ── Mission answer checking ───────────────────────────────────────────────────
// A mission tells the learner what their sentence would communicate. Bad
// authoring here teaches wrong French silently, so the authored data is checked
// against its own rules, and the honesty property (an unrecognised sentence is
// never reported as an error) is asserted directly.
const missionCtx = (() => {
  // missionCheck now writes its generated messages through the app's
  // translator, so the sandbox needs one. Use the real English strings from the
  // page rather than a stub, so these tests still read what a learner reads.
  const missionStrings = (() => {
    const src = script.slice(script.indexOf('const UI_MISSION = {'), script.indexOf('Object.keys(UI_MISSION)'));
    const box = {};
    vm.createContext(box);
    vm.runInContext(src, box);
    return vm.runInContext('UI_MISSION', box).en;
  })();
  const context = {
    t: (key, vars) => {
      let out = missionStrings[key] || key;
      if (vars) for (const k of Object.keys(vars)) out = out.replace('{' + k + '}', vars[k]);
      return out;
    },
  };
  vm.createContext(context);
  const source = script.slice(script.indexOf('// ─── MISSIONS'), script.indexOf('function MissionView('));
  assert.ok(source.includes('const MISSIONS'), 'mission source block not found in the client');
  vm.runInContext(source, context);
  return {
    MISSIONS: vm.runInContext('MISSIONS', context),
    missionCheck: vm.runInContext('missionCheck', context),
  };
})();
const missionSteps = () => missionCtx.MISSIONS.fr[0].steps;
const stepsOf = (lang) => missionCtx.MISSIONS[lang][0].steps;
const checkIn = (lang, id, answer) => {
  const step = stepsOf(lang).find(s => s.id === id);
  assert.ok(step, `no authored step ${lang}/${id}`);
  return missionCtx.missionCheck(step, answer);
};
const checkStep = (id, answer) => {
  const step = missionSteps().find(s => s.id === id);
  assert.ok(step, `no authored step ${id}`);
  return missionCtx.missionCheck(step, answer);
};

test('every authored mission step accepts its own model answer and every listed alternative', () => {
  const missions = Object.values(missionCtx.MISSIONS).flat();
  assert.ok(missions.length > 0);
  for (const mission of missions) {
    assert.ok(mission.steps.length > 0, `${mission.id} has no steps`);
    for (const step of mission.steps) {
      assert.equal(missionCtx.missionCheck(step, step.reference).verdict, 'ok',
        `${mission.id}/${step.id}: its own reference answer is not accepted`);
      for (const alternative of step.accept) {
        assert.equal(missionCtx.missionCheck(step, alternative).verdict, 'ok',
          `${mission.id}/${step.id}: authored alternative rejected — ${alternative}`);
      }
      assert.ok(step.card && step.card.front && step.card.back, `${mission.id}/${step.id}: incomplete review card`);
      assert.ok(step.task && step.reference && step.success, `${mission.id}/${step.id}: incomplete prompt`);
    }
  }
});

test('a correct answer written without accents is accepted, with the spelling noted', () => {
  const result = checkStep('dessert', 'oui, une creme brulee');
  assert.equal(result.verdict, 'ok');
  assert.ok(result.refinements.some(r => /Accents are part of the spelling/.test(r)));
});

test('near misses are diagnosed specifically rather than marked wrong', () => {
  const register = checkStep('entree', "Je veux la soupe à l'oignon");
  assert.equal(register.verdict, 'close');
  assert.match(register.message, /Je voudrais/);

  const gender = checkStep('boisson', "un carafe d'eau");
  assert.equal(gender.verdict, 'close');
  assert.match(gender.message, /feminine/);

  const wrongWord = checkStep('addition', 'la facture, merci');
  assert.equal(wrongWord.verdict, 'close');
  assert.match(wrongWord.message, /addition/);
});

test('an unrecognised but plausible sentence is reported as unchecked, never as an error', () => {
  const result = checkStep('entree', 'Je voudrais le poulet rôti');
  assert.equal(result.verdict, 'unchecked');
  assert.match(result.message, /could not check/);
  assert.doesNotMatch(result.message, /wrong|incorrect|mistake/i);
  assert.equal(checkStep('entree', '   ').verdict, 'unchecked');
});

test('an accepted answer still reports a blunt or English phrase sitting next to it', () => {
  const blended = checkStep('entree', "Je veux la soupe à l'oignon, enfin, je voudrais la soupe à l'oignon, s'il vous plaît");
  assert.equal(blended.verdict, 'ok');
  assert.ok(blended.refinements.some(r => /Je voudrais/.test(r)), 'register note was dropped on an accepted answer');
});

test('a polite-form reminder appears only when the politeness marker is missing', () => {
  assert.ok(checkStep('plat', 'je voudrais le steak-frites').refinements.some(r => /s'il vous plaît/.test(r)));
  assert.ok(!checkStep('plat', "Le steak-frites, s'il vous plaît.").refinements.some(r => /s'il vous plaît/.test(r)));
});

test('missions are only authored for languages that actually have them', () => {
  assert.ok(missionCtx.MISSIONS.fr, 'French mission missing');
  assert.equal(missionCtx.MISSIONS.zz, undefined);
});

// ── Mail transport verification ───────────────────────────────────────────────
// Account recovery depends entirely on email. The dangerous failure is reporting
// a working transport when there is none, so these assert the failure direction
// and that no credential value is ever echoed back.
const freshEmailModule = env => {
  const path = require.resolve('../utils/email');
  const saved = {};
  for (const k of ['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','RESEND_API_KEY','EMAIL_FROM']) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
  }
  delete require.cache[path];
  const mod = require('../utils/email');
  return { mod, restore() {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[path];
  }};
};

test('with no transport at all, email delivery is reported as impossible', async () => {
  const { mod, restore } = freshEmailModule({});
  try {
    const status = await mod.verifyTransport();
    assert.equal(status.smtpConfigured, false);
    assert.equal(status.smtpVerified, null);
    assert.equal(status.resendConfigured, false);
    assert.equal(status.canDeliver, false, 'claimed delivery is possible with no transport');
  } finally { restore(); }
});

test('an SMTP server that cannot be reached is reported as unable to deliver', async () => {
  // Port 1 is reserved and never listening, so this exercises a real failure.
  const { mod, restore } = freshEmailModule({
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'probe@tongue-test.invalid', SMTP_PASS: 'hunter2-should-never-appear',
  });
  try {
    const status = await mod.verifyTransport();
    assert.equal(status.smtpConfigured, true);
    assert.equal(status.smtpVerified, false, 'an unreachable SMTP server was reported as verified');
    assert.equal(status.canDeliver, false);
    assert.ok(status.smtpError, 'no diagnostic recorded for the failure');
    assert.doesNotMatch(JSON.stringify(status), /hunter2/, 'credential leaked into the status payload');
  } finally { restore(); }
});

test('a reachable SMTP server that accepts credentials is reported as verified', async () => {
  // Minimal SMTP responder: enough of the protocol for nodemailer's verify(),
  // which connects, greets, authenticates and disconnects without sending mail.
  const net = require('node:net');
  const server = net.createServer(socket => {
    socket.write('220 localhost ESMTP test\r\n');
    socket.on('data', chunk => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase();
        if (verb.startsWith('EHLO') || verb.startsWith('HELO')) socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (verb.startsWith('AUTH')) socket.write('235 2.7.0 Accepted\r\n');
        else if (verb.startsWith('QUIT')) { socket.write('221 Bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { mod, restore } = freshEmailModule({
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port),
    SMTP_USER: 'probe@tongue-test.invalid', SMTP_PASS: 'accepted',
  });
  try {
    const status = await mod.verifyTransport();
    assert.equal(status.smtpVerified, true, `verify() rejected a working server: ${status.smtpError}`);
    assert.equal(status.canDeliver, true);
  } finally { restore(); await new Promise(r => server.close(r)); }
});

test('a Resend key alone is reported as unverified, not as working', async () => {
  const { mod, restore } = freshEmailModule({ RESEND_API_KEY: 're_test_key_never_used' });
  try {
    const status = await mod.verifyTransport();
    assert.equal(status.resendConfigured, true);
    assert.equal(status.smtpVerified, null, 'claimed an SMTP result with no SMTP configured');
    assert.doesNotMatch(JSON.stringify(status), /re_test_key/, 'API key leaked into the status payload');
  } finally { restore(); }
});

// ── Product event endpoint ────────────────────────────────────────────────────
// A write endpoint the browser can reach. The risks are an open name space
// (anything can be written into the only measurement we have) and storing what
// a learner typed. Both are asserted here.
// Earlier tests in this file record events of the same name, so "the latest
// row" is not enough — wait for one written AFTER the call under test.
const eventCursor = async () =>
  Number((await db.get("SELECT COALESCE(MAX(id), 0) AS id FROM analytics_events WHERE user_id=$1", [user.id])).id);

const eventAfter = async (cursor, name, tries = 100) => {
  for (let i = 0; i < tries; i++) {
    const row = await db.get(
      "SELECT metadata FROM analytics_events WHERE user_id=$1 AND event_name=$2 AND id > $3 ORDER BY id DESC LIMIT 1",
      [user.id, name, cursor],
    );
    if (row) return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    await new Promise(r => setTimeout(r, 20));
  }
  return null;
};

test('only whitelisted event names are accepted', async () => {
  const ok = await post('/api/events', { verified: true }, { event: 'mission_started', props: { missionId: 'fr-restaurant', lang: 'fr' } });
  assert.equal(ok.status, 202);
  for (const bad of ['arbitrary_event', 'mission_started ', '', 'constructor', '__proto__']) {
    const res = await post('/api/events', { verified: true }, { event: bad });
    assert.equal(res.status, 400, `accepted unknown event name: ${JSON.stringify(bad)}`);
  }
  const noName = await post('/api/events', { verified: true }, { props: { lang: 'fr' } });
  assert.equal(noName.status, 400);
});

test('the endpoint requires a signed-in learner', async () => {
  const res = await post('/api/events', null, { event: 'mission_started' });
  assert.equal(res.status, 401);
});

test('only the declared fields are stored, and never what the learner typed', async () => {
  const marker = `probe_${suffix}`;
  const cursor = await eventCursor();
  await post('/api/events', { verified: true }, {
    event: 'mission_step_checked',
    props: {
      missionId: 'fr-restaurant', lang: 'fr', stepId: 'entree', verdict: 'close', attempt: 2,
      answer: `${marker} je veux la soupe`,        // must be dropped
      email: `${marker}@tongue-test.invalid`,      // must be dropped
      nested: { secret: marker },                  // must be dropped
    },
  });
  const meta = await eventAfter(cursor, 'mission_step_checked');
  assert.ok(meta, 'event was not recorded');
  assert.deepEqual(meta, { missionId: 'fr-restaurant', lang: 'fr', stepId: 'entree', verdict: 'close', attempt: 2 });
  assert.doesNotMatch(JSON.stringify(meta), new RegExp(marker), 'learner-supplied content was stored');
});

test('an invalid verdict is dropped rather than recorded as a real outcome', async () => {
  const cursor = await eventCursor();
  await post('/api/events', { verified: true }, {
    event: 'mission_step_checked',
    props: { missionId: 'fr-restaurant', lang: 'fr', stepId: 'plat', verdict: 'perfect', attempt: 1 },
  });
  const meta = await eventAfter(cursor, 'mission_step_checked');
  assert.ok(meta, 'event was not recorded');
  assert.equal(meta.verdict, undefined, 'an unrecognised verdict was stored');
  assert.equal(meta.stepId, 'plat');
});

test('oversized strings are truncated rather than stored whole', async () => {
  const cursor = await eventCursor();
  await post('/api/events', { verified: true }, {
    event: 'mission_started', props: { missionId: 'x'.repeat(5000), lang: 'fr' },
  });
  const meta = await eventAfter(cursor, 'mission_started');
  assert.ok(meta, 'event was not recorded');
  assert.equal(meta.missionId.length, 64);
});

// The Spanish mission is held to exactly the same bar as the French one: the
// generic test above already asserts every authored answer is accepted for
// every language. These cover the judgement calls specific to Spanish.
test('Spanish near misses are diagnosed specifically', () => {
  const register = checkIn('es', 'primero', 'Quiero la sopa');
  assert.equal(register.verdict, 'close');
  assert.match(register.message, /Quisiera/);

  const wrongWord = checkIn('es', 'cuenta', 'La factura, por favor');
  assert.equal(wrongWord.verdict, 'close');
  assert.match(wrongWord.message, /cuenta/);

  const english = checkIn('es', 'bebida', 'water please');
  assert.equal(english.verdict, 'close');
});

test('Spanish accepts regional alternatives rather than calling them wrong', () => {
  // "me pone", "me trae", "para mí" and "voy a pedir" are all ordinary ways to
  // order depending on where the speaker is from. None may be marked wrong.
  for (const answer of ['Me pone la sopa', 'Me trae la sopa, por favor', 'Para mí la sopa', 'Voy a pedir la sopa']) {
    assert.equal(checkIn('es', 'primero', answer).verdict, 'ok', `rejected a valid variant: ${answer}`);
  }
});

test('an unrecognised Spanish sentence is unchecked, never wrong', () => {
  const r = checkIn('es', 'primero', 'Quisiera el gazpacho andaluz');
  assert.equal(r.verdict, 'unchecked');
  assert.doesNotMatch(r.message, /wrong|incorrect|mistake/i);
});

test('every language with a mission has one that is complete', () => {
  for (const [lang, missions] of Object.entries(missionCtx.MISSIONS)) {
    for (const m of missions) {
      assert.ok(m.phrases.length >= 3, `${lang}: too few phrases to teach`);
      assert.ok(m.steps.length >= 3, `${lang}: too few steps`);
      assert.ok(m.outcome && m.title, `${lang}: missing outcome or title`);
    }
  }
});

// ── Mission interface strings ─────────────────────────────────────────────────
// t() falls back to English for a missing key, which is the right runtime
// behaviour and a terrible way to find out a translation was forgotten.
test('every mission string offered in English also exists in Spanish', () => {
  const src = script.slice(script.indexOf('const UI_MISSION = {'), script.indexOf('Object.keys(UI_MISSION)'));
  const box = {};
  vm.createContext(box);
  vm.runInContext(src, box);
  const dict = vm.runInContext('UI_MISSION', box);

  const missing = Object.keys(dict.en).filter((k) => !dict.es[k]);
  assert.deepEqual(missing, [], `Spanish is missing mission strings: ${missing.join(', ')}`);

  const extra = Object.keys(dict.es).filter((k) => !dict.en[k]);
  assert.deepEqual(extra, [], `Spanish has strings English does not: ${extra.join(', ')}`);

  // A placeholder dropped in translation silently renders "{n}" to the learner.
  for (const [key, english] of Object.entries(dict.en)) {
    const slots = [...english.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const translated = [...dict.es[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(translated, slots, `placeholders differ for ${key}`);
  }
});

test('mission chrome is not left hardcoded in the component', () => {
  const view = script.slice(script.indexOf('function MissionView('), script.indexOf('function lessonPracticeItems('));
  // These were the literals before they were routed through t(); if one comes
  // back, a learner in Spanish silently gets English.
  for (const literal of ['Check my answer', 'Next step', 'Finish the mission', 'MISSION COMPLETE', 'Try again']) {
    assert.ok(!view.includes(`>${literal}<`), `"${literal}" is hardcoded in MissionView again`);
  }
});

test('a browser crash is recorded without carrying the learner any further', async () => {
  const cursor = await eventCursor();
  const long = 'E'.repeat(1000);
  const res = await post('/api/events', { verified: true }, {
    event: 'client_error',
    props: { message: long, source: 'app.abc.js', line: 42, build: 'app.abc.js', view: '#learn', secret: 'must-not-persist' },
  });
  assert.equal(res.status, 202);
  const meta = await eventAfter(cursor, 'client_error');
  assert.ok(meta, 'crash was not recorded');
  // Longer than a label, because a truncated stack message is useless — but
  // still bounded, and still only the declared fields.
  assert.equal(meta.message.length, 300);
  assert.equal(meta.line, 42);
  assert.equal(meta.secret, undefined);
  assert.doesNotMatch(JSON.stringify(meta), /must-not-persist/);
});
