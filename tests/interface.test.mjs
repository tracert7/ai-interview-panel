import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as core from '../docs/core.mjs';
import {roomView} from '../docs/room-state.mjs';
import * as documents from '../docs/document-core.mjs';
import {createVoiceInput} from '../docs/voice.mjs';
import * as grading from '../docs/grade.mjs';
import {actorStates} from '../docs/game-state.mjs';
const example=JSON.parse(await readFile(new URL('../docs/example.json',import.meta.url),'utf8'));
const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
const app=(await readFile(new URL('../docs/app.js',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'');
const docText='가상 지원자는 고객 설문 24건을 분류하고 기준표를 만들었습니다.';
async function boot({local=true,voiceSupport=true,connected=true,questionsFail=false,speechStart=true,partialEvaluation=false,deferEvaluation=false}={}){
 const dom=new JSDOM(html,{url:local?'http://127.0.0.1:4317/':'https://tracert7.github.io/ai-interview-panel/',runScripts:'outside-only'}),w=dom.window,calls=[];let microphone=null;
 class Recognition{constructor(){microphone=this;}start(){if(speechStart)this.onstart?.();}stop(){this.onend?.();}abort(){}}
 Object.assign(w,core,documents,grading,{roomView,actorStates,createVoiceInput,structuredClone,TextDecoder,TextEncoder,ReadableStream,AbortController,confirm:()=>true});
 if(voiceSupport)w.SpeechRecognition=Recognition;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.fetch=async(url,options={})=>{
  calls.push({url,body:options.body?JSON.parse(options.body):null});
  const json=value=>({ok:true,json:async()=>value});
  if(url==='example.json')return json(example);
  if(url==='/api/config')return json({connected,sharing:connected,accounts:[],activeId:null});
  if(url==='/api/models')return json({models:[{id:'test-model',name:'테스트 모델'}]});
  if(url==='/api/draft')return json({draft:null});
  if(url==='/api/documents/read')return json({document:{name:'자소서.txt',text:docText,notes:[]}});
  if(url==='/api/questions')return questionsFail?{ok:false,json:async()=>({error:'가상 질문 생성 실패'})}:json({questions:core.ROLES.map(r=>({role:r.id,question:r.name+'의 서류 질문',source:'자소서.txt',quote:'고객 설문 24건을 분류하고 기준표를 만들었습니다.',intent:'본인이 한 일을 확인합니다.'}))});
  if(url==='/api/evaluate')return {ok:true,body:new ReadableStream({start(c){if(deferEvaluation){w.testEvaluation=c;return;}for(const role of core.ROLES){const event=partialEvaluation&&role.id==='lead'?{type:'error',role:role.id,error:'가상 부분 실패'}:{type:'result',result:{role:role.id,scores:[2,2,2,2,2],quote:'분류',reason:'설명 필요',improvement:'기준 설명',followup:'어떤 기준인가요?',total:10}};c.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\n'));}c.enqueue(new TextEncoder().encode('{"type":"done"}\n'));c.close();}})};
  throw Error('Unexpected UI request: '+url);
 };
 // Execute the voice module in the browser realm as well: Node timers hide illegal Window receiver bugs.
 const voiceSource=(await readFile(new URL('../docs/voice.mjs',import.meta.url),'utf8')).replace('export function createVoiceInput','function createVoiceInput');
 vm.runInContext(voiceSource,dom.getInternalVMContext());
 await vm.runInContext('(async()=>{'+app+'})()',dom.getInternalVMContext());
 return {dom,w,calls,$:id=>w.document.getElementById(id),get microphone(){return microphone;}};
}
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw Error('UI state timed out');await new Promise(r=>setTimeout(r,5));}}
test('UI game: question → speaking/listening → per-role streaming reactions → result CTA',async()=>{
 const h=await boot({deferEvaluation:true}),{$,w}=h;try{
  $('job').value='가상 인턴';$('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));$('consent').checked=true;$('start-interview').click();
  const actor=id=>w.document.querySelector('[data-actor="'+id+'"]');
  assert.equal(actor('hr').dataset.pose,'speaking');assert.equal($('dialogue-speaker').textContent,'인사담당자');
  actor('lead').click();assert.equal(actor('lead').dataset.pose,'speaking');assert.equal($('game-scene').dataset.speaker,'lead');
  $('answer').value='고객 의견을 분류했습니다.';$('answer').dispatchEvent(new w.Event('input'));assert.equal(actor('lead').dataset.pose,'listening');
  $('evaluate').click();await until(()=>w.testEvaluation);for(const id of ['hr','lead','practitioner'])assert.equal(actor(id).dataset.pose,'thinking');
  const send=value=>w.testEvaluation.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
  send({type:'result',result:{role:'hr',scores:[2,2,2,2,2],reason:'설명',improvement:'보완',followup:'기준은?',total:10}});await until(()=>actor('hr').dataset.pose==='ready');assert.equal(actor('lead').dataset.pose,'thinking');assert.equal($('scene-result').hidden,true);
  $('motion-toggle').click();assert.equal($('game-scene').dataset.motion,'off');assert.equal(actor('lead').dataset.pose,'thinking');
  send({type:'error',role:'lead',error:'테스트 부분 실패'});send({type:'result',result:{role:'practitioner',scores:[2,2,2,2,2],reason:'설명',improvement:'보완',followup:'근거는?',total:10}});send({type:'done'});w.testEvaluation.close();
  await until(()=>!$('evaluate').disabled);assert.equal(actor('lead').dataset.pose,'error');assert.equal(actor('practitioner').dataset.pose,'ready');assert.equal($('scene-result').hidden,false);assert.equal($('overall-grade-heading').textContent,'종합 등급 보류');
  $('scene-result').click();assert.equal(w.document.activeElement,$('overall-grade-heading'));assert.equal(h.calls.filter(c=>c.url==='/api/evaluate').length,1);
 }finally{h.dom.window.close();}
});
test('UI game: clearly labelled movement preview never calls AI or changes grades',async()=>{
 const h=await boot(),{$,w}=h;try{
  $('mode-example').click();await until(()=>!$('example-tools').hidden);$('example-feedback').click();const grade=$('overall-grade').dataset.grade;
  $('game-preview').click();assert.equal($('room-state').textContent,'연출 미리보기');assert($('scene-caption').textContent.includes('AI 호출 없음'));assert.equal(w.document.querySelector('[data-actor=hr]').dataset.pose,'thinking');assert.equal($('overall-grade').dataset.grade,grade);assert.equal(h.calls.filter(c=>c.url==='/api/evaluate').length,0);
  $('first-example').click();assert.notEqual($('room-state').textContent,'연출 미리보기');
 }finally{h.dom.window.close();}
});
test('UI: attachment preview → role questions → voice text → real-submit shape; no automatic send',async()=>{
 const h=await boot(),{$,w}=h;
 try{
  assert.equal(w.document.body.dataset.stage,'prepare');assert.equal($('entry-panel').hidden,false);assert.equal($('practice-panel').hidden,true);assert.equal($('setup-panel').open,false);assert.equal($('settings-dialog').open,false);assert.equal($('job').value,'');assert.equal($('mode-work'),null);
  $('job').value='고객 조사 마케팅 인턴';
  $('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));
  const file=new w.File([docText],'자소서.txt',{type:'text/plain'});Object.defineProperty($('document-files'),'files',{configurable:true,value:[file]});$('document-files').dispatchEvent(new w.Event('change'));
  await until(()=>$('document-count').textContent==='첨부 1 / 3'&&!$('generate-questions').disabled);
  assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,0);assert.equal($('document-list').querySelector('textarea').value,docText);
  $('consent').checked=true;$('start-interview').click();await until(()=>w.document.body.dataset.stage==='interview');
  assert.equal($('question').value,'인사담당자의 서류 질문');assert.equal($('entry-panel').hidden,true);assert.equal($('practice-panel').hidden,false);assert.equal($('evaluate').hidden,true);assert.equal($('answer-review').open,false);assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,1);
  $('voice-start').click();assert.equal(h.microphone,null);assert.equal($('voice-consent'),w.document.activeElement);
  $('voice-consent').checked=true;$('voice-start').click();assert(h.microphone);assert.equal($('voice-indicator').hidden,false);
  const result=Object.assign([{transcript:'저는 설문을 분류했습니다.'}],{isFinal:true});h.microphone.onresult({resultIndex:0,results:[result]});assert.equal($('answer').value,'저는 설문을 분류했습니다.');
  assert.equal(h.calls.filter(c=>c.url==='/api/evaluate').length,0);assert.equal($('evaluate').hidden,true);$('voice-stop').click();assert.equal($('voice-indicator').hidden,true);assert.equal($('evaluate').hidden,false);
  $('evaluate').click();await until(()=>$('feedback-panel').open&&!$('evaluate').disabled);
  assert.equal($('agent-grid').children.length,3);assert.equal(h.calls.find(c=>c.url==='/api/evaluate').body.documents[0].text,docText);
  assert.equal($('overall-grade').hidden,false);assert.equal($('overall-grade').dataset.grade,'E');assert($('overall-grade').textContent.includes('30 / 60점'));assert.equal($('history').querySelector('.history-rank').textContent,'E');
  $('back-to-prepare').click();assert.equal(w.document.body.dataset.stage,'prepare');assert.equal($('answer').value,'저는 설문을 분류했습니다.');
  $('start-interview').click();await until(()=>w.document.body.dataset.stage==='interview');assert.equal($('answer').value,'저는 설문을 분류했습니다.');assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,1);$('back-to-prepare').click();
  $('document-list').querySelector('textarea').value='수정한 서류 내용';$('document-list').querySelector('textarea').dispatchEvent(new w.Event('input'));assert.equal($('question-bank').hidden,true);assert.equal($('consent').checked,false);
  assert.equal($('overall-grade').hidden,true);
  $('reset').click();assert.equal($('document-count').textContent,'첨부 0 / 3');assert.equal($('answer').value,'');
 }finally{h.dom.window.close();}
});
test('UI: no premature grade; recorded examples show computed E and A+ with explicit source',async()=>{
 const h=await boot(),{$,w}=h;try{
  assert.equal($('overall-grade').hidden,true);$('mode-example').click();await until(()=>!$('example-tools').hidden);assert.equal($('overall-grade').hidden,true);
  $('example-feedback').click();assert.equal($('overall-grade').dataset.grade,'E');assert($('overall-grade-heading').textContent.includes('기록된 예제'));
  $('second-example').click();assert.equal($('overall-grade').hidden,true);$('example-feedback').click();assert.equal($('overall-grade').dataset.grade,'A+');assert($('overall-grade').textContent.includes('56 / 60점'));
  const letter=$('overall-grade').querySelector('.grade-letter').textContent;w.document.querySelector('[data-speaker="lead"]').click();assert.equal($('overall-grade').querySelector('.grade-letter').textContent,letter);
 }finally{h.dom.window.close();}
});
test('UI: partial evaluation withholds overall grade rather than assigning F',async()=>{
 const h=await boot({partialEvaluation:true}),{$,w}=h;try{
  $('job').value='가상 조사 인턴';$('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));$('consent').checked=true;$('start-interview').click();$('answer').value='고객 의견을 분류했습니다.';$('answer').dispatchEvent(new w.Event('input'));$('evaluate').click();await until(()=>$('feedback-panel').open&&!$('evaluate').disabled);
  assert.equal($('overall-grade').hidden,false);assert.equal($('overall-grade').getAttribute('data-grade'),null);assert.equal($('overall-grade').querySelector('.grade-letter'),null);assert.equal($('overall-grade-heading').textContent,'종합 등급 보류');assert($('overall-grade').textContent.includes('2 / 3개'));assert.equal($('history').children[0].children[4].textContent,'보류');
 }finally{h.dom.window.close();}
});
test('UI: public demo does not enable server attachments, and unsupported speech has honest fallback',async()=>{
 const h=await boot({local:false,voiceSupport:false});try{
  assert.equal(h.$('entry-panel').hidden,false);assert.equal(h.$('document-files').disabled,true);h.$('job').value='인턴';h.$('start-interview').click();assert.equal(h.$('practice-panel').hidden,true);assert(h.$('prepare-status').textContent.includes('PC에서 실행'));
  h.$('mode-example').click();await until(()=>!h.$('practice-panel').hidden);assert.equal(h.$('voice-tools').hidden,true);assert(h.$('voice-status').textContent.includes('지원하지'));assert.equal(h.calls.filter(c=>c.url.startsWith('/api/')).length,0);
 }finally{h.dom.window.close();}
});

test('UI: single start opens settings only when needed; no-file entry is local and preserves draft',async()=>{
 const h=await boot(),{$,w}=h;try{
  $('start-interview').click();assert.equal(w.document.activeElement,$('job'));$('job').value='제품 기획 인턴';$('start-interview').click();assert.equal($('settings-dialog').open,true);assert.equal(h.calls.filter(c=>['/api/questions','/api/evaluate'].includes(c.url)).length,0);
  $('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));$('settings-done').click();assert.equal($('settings-dialog').open,false);$('start-interview').click();assert.equal(w.document.activeElement,$('consent'));
  $('consent').checked=true;$('start-interview').click();assert.equal(w.document.body.dataset.stage,'interview');assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,0);assert.equal(h.microphone,null);
  $('type-answer').click();assert.equal($('answer-review').open,true);assert.equal(w.document.activeElement,$('answer'));$('answer').value='내가 직접 분류했습니다.';$('answer').dispatchEvent(new w.Event('input'));
  $('back-to-prepare').click();assert.equal($('answer').value,'내가 직접 분류했습니다.');$('mode-example').click();await until(()=>!$('example-tools').hidden);assert.equal($('job').value,example.job);$('mode-live').click();await until(()=>w.document.body.dataset.stage==='prepare');assert.equal($('job').value,'제품 기획 인턴');assert.equal($('answer').value,'내가 직접 분류했습니다.');
 }finally{h.dom.window.close();}
});
test('UI: failed document question generation stays at entry; never auto-submits or opens microphone',async()=>{
 const h=await boot({questionsFail:true}),{$,w}=h;try{
  $('job').value='조사 인턴';$('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));
  Object.defineProperty($('document-files'),'files',{value:[new w.File([docText],'자소서.txt')]});$('document-files').dispatchEvent(new w.Event('change'));await until(()=>$('document-count').textContent==='첨부 1 / 3'&&!$('generate-questions').disabled);
  $('consent').checked=true;$('start-interview').click();await until(()=>$('prepare-status').textContent==='가상 질문 생성 실패');assert.equal(w.document.body.dataset.stage,'prepare');assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,1);assert.equal(h.calls.filter(c=>c.url==='/api/evaluate').length,0);assert.equal(h.microphone,null);
 }finally{h.dom.window.close();}
});
test('UI: pending speech connection shows cancel, not listening; network failure preserves typed answer',async()=>{
 const h=await boot({speechStart:false}),{$,w}=h;try{
  $('job').value='인턴';$('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));$('consent').checked=true;$('start-interview').click();
  $('answer').value='이미 작성한 답변';$('answer').dispatchEvent(new w.Event('input'));$('voice-consent').checked=true;$('voice-start').click();
  assert.equal($('room-state').textContent,'마이크 연결 요청 중');assert.equal($('voice-indicator').hidden,true);assert.equal($('voice-stop').textContent,'연결 취소');assert.equal($('voice-start').getAttribute('aria-pressed'),'false');assert.equal($('evaluate').hidden,true);
  h.microphone.onerror({error:'network'});assert.equal($('voice-stop').hidden,true);assert.equal($('answer').value,'이미 작성한 답변');assert($('voice-status').textContent.includes('network'));assert.equal($('evaluate').hidden,false);
 }finally{h.dom.window.close();}
});
