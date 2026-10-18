import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVoiceInput} from '../docs/voice.mjs';
function harness(){let current,starts=0,stops=0,text=[],interim=[],messages=[],states=[],phases=[],timerId=0;const scheduled=new Map();
 class Recognition{constructor(){current=this;}start(){starts++;}stop(){stops++;}abort(){stops++;}}
 const voice=createVoiceInput({Recognition,onText:t=>text.push(t),onInterim:t=>interim.push(t),onState:(s,phase)=>{states.push(s);phases.push(phase);},onMessage:m=>messages.push(m),timers:{setTimeout(fn,ms){const id=++timerId;scheduled.set(id,{fn,ms});return id;},clearTimeout(id){scheduled.delete(id);}}});
 const result=(value,final)=>Object.assign([{transcript:value}],{isFinal:final});
 return {voice,text,interim,messages,states,phases,scheduled,result,get current(){return current;},get starts(){return starts;},get stops(){return stops;}};
}
test('microphone does not start before explicit action; Korean recognition and final-only append',()=>{
 const h=harness();assert.equal(h.starts,0);h.voice.start();assert.equal(h.starts,1);assert.equal(h.current.lang,'ko-KR');assert.equal(h.current.continuous,true);assert.equal(h.voice.phase,'connecting');assert.equal(h.voice.listening,false);h.current.onstart();assert.equal(h.voice.phase,'listening');assert.equal(h.scheduled.size,0);
 h.current.onresult({resultIndex:0,results:[h.result('아직 인식 중',false)]});assert.equal(h.text.length,0);assert.equal(h.interim.at(-1),'아직 인식 중');
 h.current.onresult({resultIndex:0,results:[h.result('고객 설문을 분류했습니다.',true)]});h.current.onresult({resultIndex:0,results:[h.result('고객 설문을 분류했습니다.',true),h.result('기준표도 만들었습니다.',true)]});
 assert.deepEqual(h.text,['고객 설문을 분류했습니다.','기준표도 만들었습니다.']);assert.equal(h.voice.start(),false);h.voice.stop({discard:true});
});
test('stopping can accept final speech; discard ignores late events and never restarts',()=>{
 const h=harness();h.voice.start();h.current.onstart();h.voice.stop();h.current.onresult({resultIndex:0,results:[h.result('마지막 문장',true)]});h.current.onend();assert.equal(h.voice.active,false);assert.equal(h.text[0],'마지막 문장');assert.equal(h.starts,1);
 h.voice.start();const previous=h.current;h.voice.stop({discard:true});previous.onresult({resultIndex:0,results:[h.result('전송 후 늦게 도착한 문장',true)]});assert.equal(h.text.length,1);assert.equal(h.voice.active,false);
});
test('connection timeout stops pending request without ever claiming listening; late events ignored',()=>{
 const h=harness();h.voice.start();const previous=h.current;
 assert(h.messages.at(-1).includes('아직 듣기 시작한 상태는 아닙니다'));assert(!h.phases.includes('listening'));assert.equal(h.scheduled.size,1);
 const timer=[...h.scheduled.values()][0];assert.equal(timer.ms,12000);timer.fn();assert.equal(h.voice.active,false);assert(h.messages.at(-1).includes('12초'));assert.equal(h.starts,1);assert.equal(h.stops,1);
 previous.onstart();previous.onresult({resultIndex:0,results:[h.result('늦은 결과',true)]});assert.equal(h.voice.listening,false);assert.equal(h.text.length,0);
});
test('connection cancel and empty session end do not claim completed speech',()=>{
 const h=harness();h.voice.start();h.voice.stop();assert.equal(h.voice.phase,'idle');assert(h.messages.at(-1).includes('시작되지 않았습니다'));assert.equal(h.scheduled.size,0);
 h.voice.start();h.current.onend();assert(h.messages.at(-1).includes('시작되기 전에'));h.voice.start();h.current.onaudiostart();assert.equal(h.voice.listening,true);h.current.onend();assert(h.messages.at(-1).includes('인식된 문장이 없습니다'));assert.equal(h.scheduled.size,0);
});
test('default timer adapters do not invoke browser-native timers with an illegal receiver',async()=>{
 const source=(await readFile(new URL('../docs/voice.mjs',import.meta.url),'utf8')).replace('export function createVoiceInput','function createVoiceInput');
 let calls=0,current;
 const nativeSet=function(){'use strict';assert.equal(this,undefined);calls++;return 1;};
 const nativeClear=function(){'use strict';assert.equal(this,undefined);};
 const factory=Function('setTimeout','clearTimeout','"use strict";'+source+';return createVoiceInput;')(nativeSet,nativeClear);
 class Recognition{constructor(){current=this;}start(){}abort(){}}
 const voice=factory({Recognition,onText(){}});assert.equal(voice.start(),true);assert.equal(calls,1);current.onstart();assert.equal(voice.listening,true);voice.stop({discard:true});assert.equal(voice.active,false);
});
test('permission/network failures preserve text and explain keyboard fallback; unsupported never opens mic',()=>{
 for(const error of ['not-allowed','network','no-speech','audio-capture']){const h=harness();h.voice.start();h.current.onerror({error});assert.equal(h.voice.active,false);assert(h.messages.at(-1).length>10);assert.equal(h.starts,1);}
 let message='';const voice=createVoiceInput({Recognition:null,onText:()=>assert.fail(),onMessage:m=>message=m});assert.equal(voice.supported,false);assert.equal(voice.start(),false);assert(message.includes('지원하지'));
});
