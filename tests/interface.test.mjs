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
async function boot({local=true,voiceSupport=true}={}){
 const dom=new JSDOM(html,{url:local?'http://127.0.0.1:4317/':'https://tracert7.github.io/ai-interview-panel/',runScripts:'outside-only'}),w=dom.window,calls=[];let microphone=null;
 class Recognition{constructor(){microphone=this;}start(){}stop(){this.onend?.();}abort(){}}
 Object.assign(w,core,documents,{roomView,createVoiceInput,structuredClone,TextDecoder,TextEncoder,ReadableStream,AbortController,confirm:()=>true});
 if(voiceSupport)w.SpeechRecognition=Recognition;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async(url,options={})=>{
  calls.push({url,body:options.body?JSON.parse(options.body):null});
  const json=value=>({ok:true,json:async()=>value});
  if(url==='example.json')return json(example);
  if(url==='/api/config')return json({connected:true,sharing:true,accounts:[],activeId:null});
  if(url==='/api/models')return json({models:[{id:'test-model',name:'테스트 모델'}]});
  if(url==='/api/draft')return json({draft:null});
  if(url==='/api/documents/read')return json({document:{name:'자소서.txt',text:docText,notes:[]}});
  if(url==='/api/questions')return json({questions:core.ROLES.map(r=>({role:r.id,question:r.name+'의 서류 질문',source:'자소서.txt',quote:'고객 설문 24건을 분류하고 기준표를 만들었습니다.',intent:'본인이 한 일을 확인합니다.'}))});
  if(url==='/api/evaluate')return {ok:true,body:new ReadableStream({start(c){for(const role of core.ROLES)c.enqueue(new TextEncoder().encode(JSON.stringify({type:'result',result:{role:role.id,scores:[2,2,2,2,2],quote:'분류',reason:'설명 필요',improvement:'기준 설명',followup:'어떤 기준인가요?',total:10}})+'\n'));c.enqueue(new TextEncoder().encode('{"type":"done"}\n'));c.close();}})};
  throw Error('Unexpected UI request: '+url);
 };
 await vm.runInContext('(async()=>{'+app+'})()',dom.getInternalVMContext());
 return {dom,w,calls,$:id=>w.document.getElementById(id),get microphone(){return microphone;}};
}
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw Error('UI state timed out');await new Promise(r=>setTimeout(r,5));}}
test('UI: attachment preview → role questions → voice text → real-submit shape; no automatic send',async()=>{
 const h=await boot(),{$,w}=h;
 try{
  assert.equal($('documents-panel').hidden,false);assert.equal($('voice-tools').hidden,false);assert.equal($('setup-panel').open,false);
  $('model-select').value='test-model';$('model-select').dispatchEvent(new w.Event('change'));
  const file=new w.File([docText],'자소서.txt',{type:'text/plain'});Object.defineProperty($('document-files'),'files',{configurable:true,value:[file]});$('document-files').dispatchEvent(new w.Event('change'));
  await until(()=>$('document-count').textContent==='첨부 1 / 3'&&!$('generate-questions').disabled);
  assert.equal(h.calls.filter(c=>c.url==='/api/questions').length,0);assert.equal($('document-list').querySelector('textarea').value,docText);
  $('consent').checked=true;$('generate-questions').click();await until(()=>$('question-bank').children.length===3&&!$('generate-questions').disabled);
  $('question-bank').querySelector('button').click();assert.equal($('question').value,'인사담당자의 서류 질문');
  $('voice-start').click();assert.equal(h.microphone,null);assert.equal($('voice-consent'),w.document.activeElement);
  $('voice-consent').checked=true;$('voice-start').click();assert(h.microphone);assert.equal($('voice-indicator').hidden,false);
  const result=Object.assign([{transcript:'저는 설문을 분류했습니다.'}],{isFinal:true});h.microphone.onresult({resultIndex:0,results:[result]});assert.equal($('answer').value,'저는 설문을 분류했습니다.');
  assert.equal(h.calls.filter(c=>c.url==='/api/evaluate').length,0);$('voice-stop').click();assert.equal($('voice-indicator').hidden,true);
  $('evaluate').click();await until(()=>$('feedback-panel').open&&!$('evaluate').disabled);
  assert.equal($('agent-grid').children.length,3);assert.equal(h.calls.find(c=>c.url==='/api/evaluate').body.documents[0].text,docText);
  $('document-list').querySelector('textarea').value='수정한 서류 내용';$('document-list').querySelector('textarea').dispatchEvent(new w.Event('input'));assert.equal($('question-bank').hidden,true);assert.equal($('consent').checked,false);
  $('reset').click();assert.equal($('document-count').textContent,'첨부 0 / 3');assert.equal($('answer').value,'');
 }finally{h.dom.window.close();}
});
test('UI: public demo does not enable server attachments, and unsupported speech has honest fallback',async()=>{
 const h=await boot({local:false,voiceSupport:false});try{
  assert.equal(h.$('documents-panel').hidden,true);h.$('mode-live').click();await until(()=>!h.$('documents-panel').hidden);
  assert.equal(h.$('document-files').disabled,true);assert.equal(h.$('voice-start').disabled,true);assert(h.$('voice-status').textContent.includes('지원하지'));
 }finally{h.dom.window.close();}
});
