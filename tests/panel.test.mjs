import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ROLES,validateInput,validateFeedback,buildRequest} from '../docs/core.mjs';
import {createApp,evaluateRole} from '../server.mjs';
const input={job:'가상 공고',facts:'카드뉴스 네 개 제작',question:'무엇을 했나요?',answer:'카드뉴스 네 개를 제작했습니다.'};
const good={scores:[3,3,2,3,1],quote:'카드뉴스',reason:'본인 작업이 확인됩니다.',improvement:'범위를 밝혀 주세요.',followup:'본인이 한 일은 무엇인가요?'};
test('input length / blanks / feedback integer range and literal quote',()=>{
 assert.equal(validateInput(input).job,'가상 공고');
 for(const x of [{...input,answer:''},{...input,facts:'x'.repeat(8001)}])assert.throws(()=>validateInput(x));
 assert.equal(validateFeedback(good,input.answer).total,12);
 assert.throws(()=>validateFeedback({...good,scores:[5,1,1,1,1]},input.answer));
 assert.throws(()=>validateFeedback({...good,scores:[1,1]},input.answer));
 assert.throws(()=>validateFeedback({...good,quote:'없는 인용'},input.answer));
});
test('three separate role contexts contain no prior scores, tools, histories or keys',()=>{
 const bodies=ROLES.map(r=>buildRequest(r,input,'test-model'));
 assert.equal(new Set(bodies.map(x=>x.instructions)).size,3);
 for(const b of bodies){assert.equal(b.store,false);assert.equal(b.input.length,1);assert.equal(b.max_output_tokens,1800);assert.equal(b.tools,undefined);assert.equal(b.previous_response_id,undefined);assert.equal(JSON.parse(b.input[0].content).답변,input.answer);assert.equal(b.text.format.strict,true);}
});
test('API transport uses Responses strict schema and parses completed response',async()=>{
 const r=await evaluateRole(ROLES[0],input,{apiKey:'TEST_ONLY_NOT_A_KEY',model:'test-model',fetchImpl:async(url,opt)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(opt.body).model,'test-model');
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(good)}]}],usage:{input_tokens:100,output_tokens:30}})};
 }});
 assert.equal(r.total,12);assert.equal(r.usage.input_tokens,100);
});
test('incomplete / refusal / invalid quote / API error do not become scored success',async()=>{
 for(const data of [{status:'incomplete'},{status:'completed',output:[]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({...good,quote:'invented'})}]}]}])
  await assert.rejects(evaluateRole(ROLES[0],input,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:true,json:async()=>data})}));
 await assert.rejects(evaluateRole(ROLES[0],input,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:false,status:429})}),/자동 재시도/);
});
async function withServer(options,fn){const server=createApp(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;try{await fn(base);}finally{await new Promise(r=>server.close(r));}}
test('keyless mode is safe and config never exposes key',async()=>withServer({apiKey:'',model:''},async base=>{
 assert.equal((await fetch(base+'/')).status,200);
 assert.equal((await(await fetch(base+'/api/config')).json()).ready,false);
 const post=await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)});assert.equal(post.status,503);
 assert.equal((await fetch(base+'/server.mjs')).status,404);
}));
test('same origin required; parallel 3 calls, partial failure and no auto retry',async()=>{
 let calls=0,active=0,peak=0;
 await withServer({apiKey:'TEST_ONLY',model:'test',fetchImpl:async()=>{
   const n=++calls;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,20));active--;
   return n===2?{ok:false,status:429}:{ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(good)}]}]})};
 }},async base=>{
  const cfg=await(await fetch(base+'/api/config')).text();assert(!cfg.includes('TEST_ONLY'));
  assert.equal((await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:'{}'})).status,403);
  const r=await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)});
  const events=(await r.text()).trim().split('\n').map(JSON.parse);assert.equal(events.filter(x=>x.type==='result').length,2);assert.equal(events.filter(x=>x.type==='error').length,1);assert.equal(events.at(-1).type,'done');
  assert.equal(calls,3);assert.equal(peak,3);
  assert.equal((await fetch(base+'/api/evaluate',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input)})).status,429);
 });
});
test('published example preserves 6 verified totals, exact 5-item rubric',async()=>{
 const e=JSON.parse(await readFile(new URL('../docs/example.json',import.meta.url),'utf8'));
 assert.deepEqual(e.rounds.map(r=>r.results.map(x=>x.scores.reduce((a,b)=>a+b,0))),[[12,11,11],[19,18,19]]);
 for(const r of e.rounds)for(const v of r.results){assert.equal(v.scores.length,5);assert.equal(v.total,v.scores.reduce((a,b)=>a+b,0));}
});
