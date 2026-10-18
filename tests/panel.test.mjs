import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ROLES,validateInput,validateFeedback} from '../docs/core.mjs';
import {buildPlanRequest} from '../lib/plan-inference.mjs';
import {createApp,evaluateRole} from '../server.mjs';
const input={job:'가상 공고',facts:'카드뉴스 네 개 제작',question:'무엇을 했나요?',answer:'카드뉴스 네 개를 제작했습니다.',model:'test-model'};
const good={scores:[3,3,2,3,1],quote:'카드뉴스',reason:'본인 작업이 확인됩니다.',improvement:'범위를 밝혀 주세요.',followup:'본인이 한 일은 무엇인가요?'};
function stream(data){return {ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(data)+'\n\n'));c.close();}})};}
function completed(value=good){return stream({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:30}}});}
function fakeAuth(connected=false){return {ready:Promise.resolve(),cachedModels:[{id:'test-model',name:'Test model'}],publicStatus:()=>({connected,sharing:connected,accounts:[]}),credentials:async()=>({accessToken:'SYNTHETIC_OAUTH_TEST_TOKEN'}),models:async()=>[{id:'test-model',name:'Test model'}]};}
test('input lengths, five integer scores, sum and literal quote are validated',()=>{
 assert.equal(validateInput(input).job,'가상 공고');
 for(const x of [{...input,answer:''},{...input,facts:'x'.repeat(8001)}])assert.throws(()=>validateInput(x));
 assert.equal(validateFeedback(good,input.answer).total,12);
 assert.throws(()=>validateFeedback({...good,scores:[5,1,1,1,1]},input.answer));
 assert.throws(()=>validateFeedback({...good,scores:[1,1]},input.answer));
 assert.throws(()=>validateFeedback({...good,quote:'없는 인용'},input.answer));
});
test('plan requests isolate roles and omit unsupported / paid-API-only fields',()=>{
 const bodies=ROLES.map(r=>buildPlanRequest(r,input,'test-model'));
 assert.equal(new Set(bodies.map(x=>x.instructions)).size,3);
 for(const b of bodies){assert.equal(b.store,false);assert.equal(b.stream,true);assert.equal(b.input.length,1);assert.equal(b.max_output_tokens,undefined);assert.equal(b.tools,undefined);assert.equal(b.multi_agent,undefined);assert.equal(b.previous_response_id,undefined);assert.equal(JSON.parse(b.input[0].content).답변,input.answer);assert.equal(b.text.format.strict,true);}
});
test('OAuth bearer request requires response.completed and parses structured feedback',async()=>{
 const r=await evaluateRole(ROLES[0],input,{accessToken:'SYNTHETIC_OAUTH_TEST_TOKEN',model:'test-model',fetchImpl:async(url,opt)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(opt.body).stream,true);assert.equal(opt.redirect,'error');return completed();
 }});
 assert.equal(r.total,12);assert.equal(r.usage.input_tokens,100);
});
test('stream failure, incomplete output, bad quote, and usage limit never become success',async()=>{
 for(const result of [stream({type:'response.incomplete'}),stream({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}),stream({type:'response.output_text.delta',delta:'{}'}),completed({...good,quote:'invented'})])
  await assert.rejects(evaluateRole(ROLES[0],input,{accessToken:'test',model:'test',fetchImpl:async()=>result}));
 await assert.rejects(evaluateRole(ROLES[0],input,{accessToken:'test',model:'test',fetchImpl:async()=>({ok:false,status:429})}),/별도 API 결제/);
});
async function withServer(options,fn){const server=createApp({auth:fakeAuth(false),...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{await fn(base);}finally{await new Promise(r=>server.close(r));}}
test('disconnected app cannot evaluate; config has no token and no API-key fallback',async()=>withServer({},async base=>{
 assert.equal((await fetch(base+'/')).status,200);
 const cfg=await(await fetch(base+'/api/config')).json();assert.equal(cfg.ready,false);assert.equal(cfg.apiKeyFallback,false);assert(!JSON.stringify(cfg).includes('SYNTHETIC'));
 const post=await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)});assert.equal(post.status,401);
 assert.equal((await fetch(base+'/server.mjs')).status,404);
 assert.equal((await fetch(base+'/.private/accounts.auth.enc')).status,404);
}));
test('same-origin auth and evaluation; 3 concurrent contexts; partial failure has no retry',async()=>{
 let calls=0,active=0,peak=0;
 await withServer({auth:fakeAuth(true),fetchImpl:async()=>{
   const n=++calls;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;
   return n===2?{ok:false,status:429}:completed();
 }},async base=>{
  assert.equal((await fetch(base+'/api/auth/start',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)})).status,403);
  const opts={method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)};
  const r=await fetch(base+'/api/evaluate',opts);const events=(await r.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(x=>x.type==='result').length,2);assert.equal(events.filter(x=>x.type==='error').length,1);assert.equal(events.at(-1).type,'done');assert.equal(calls,3);assert.equal(peak,3);
  assert.equal((await fetch(base+'/api/evaluate',opts)).status,429);
 });
});
test('model slug must belong to the current account catalog',async()=>withServer({auth:fakeAuth(true)},async base=>{
 const r=await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify({...input,model:'not-in-catalog'})});assert.equal(r.status,400);
}));
test('recorded example retains original verified Work scores',async()=>{
 const e=JSON.parse(await readFile(new URL('../docs/example.json',import.meta.url),'utf8'));
 assert.deepEqual(e.rounds.map(r=>r.results.map(x=>x.scores.reduce((a,b)=>a+b,0))),[[12,11,11],[19,18,19]]);
 for(const r of e.rounds)for(const v of r.results)assert.equal(v.total,v.scores.reduce((a,b)=>a+b,0));
});
