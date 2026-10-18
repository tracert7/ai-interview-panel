import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as core from '../docs/core.mjs';
import {roomView} from '../docs/room-state.mjs';
import * as documents from '../docs/document-core.mjs';
import {createVoiceInput} from '../docs/voice.mjs';
const example=JSON.parse(await readFile(new URL('../docs/example.json',import.meta.url),'utf8'));
const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
const app=(await readFile(new URL('../docs/app.js',import.meta.url),'utf8')).replace(/^import .+;\r?\n/gm,'');
const docText='가상 지원자는 고객 설문 24건을 분류하고 기준표를 만들었습니다.';
async function boot({local=true,voiceSupport=true,connected=true,questionsFail=false,speechStart=true}={}){
 const dom=new JSDOM(html,{url:local?'http://127.0.0.1:4317/':'https://tracert7.github.io/ai-interview-panel/',runScripts:'outside-only'}),w=dom.window,calls=[];let microphone=null;
 class Recognition{constructor(){microphone=this;}start(){if(speechStart)this.onstart?.();}stop(){this.onend?.();}abort(){}}
 Object.assign(w,core,documents,{roomView,createVoiceInput,structuredClone,TextDecoder,TextEncoder,ReadableStream,AbortController,confirm:()=>true});
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
  if(url==='/api/evaluate')return {ok:true,body:new ReadableStream({start(c){for(const role of core.ROLES)c.enqueue(new TextEncoder().encode(JSON.stringify({type:'result',result:{role:role.id,scores:[2,2,2,2,2],quote:'분류',reason:'설명 필요',improvement:'기준 설명',followup:'어떤 기준인가요?',total:10}})+'\n'));c.enqueue(new TextEncoder().encode('{"type":"done"}\n'));c.close();}})};
  throw Error('Unexpected UI request: '+url);
 };
 // Execute the voice module in the browser realm as well: Node timers hide illegal Window receiver bugs.
 const voiceSource=(await readFile(new URL('../docs/voice.mjs',import.meta.url),'utf8')).replace('export function createVoiceInput','function createVoiceInput');
 vm.runInContext(voiceSource,dom.getInternalVMContext());
 await vm.runInContext('(async()=>{'+app+'})()',dom.getInternalVMContext());
 return {dom,w,calls,$:id=>w.document.getElementById(id),get microphone(){return microphone;}};
}
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw Error('UI state timed out');await new Promise(r=>setTimeout(r,5));}}
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
  $('back-to-prepare').click();assert.equal(w.document.body.dataset.stage,'prepare');assert.equal($('answer').value,'저는 설문을 분류했습니다.');
  $('start-interview').click();await until(()=>w.document.body.dataset.stage==='interview');assert.equal($('answer').value,'저는 설문을 분류했습니다.');assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,1);$('back-to-prepare').click();
  $('document-list').querySelector('textarea').value='수정한 서류 내용';$('document-list').querySelector('textarea').dispatchEvent(new w.Event('input'));assert.equal($('question-bank').hidden,true);assert.equal($('consent').checked,false);
  $('reset').click();assert.equal($('document-count').textContent,'첨부 0 / 3');assert.equal($('answer').value,'');
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
