import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceInput} from '../docs/voice.mjs';
function harness(){let current,starts=0,stops=0,text=[],interim=[],messages=[],states=[];
 class Recognition{constructor(){current=this;}start(){starts++;}stop(){stops++;}abort(){stops++;}}
 const voice=createVoiceInput({Recognition,onText:t=>text.push(t),onInterim:t=>interim.push(t),onState:s=>states.push(s),onMessage:m=>messages.push(m)});
 const result=(value,final)=>Object.assign([{transcript:value}],{isFinal:final});
 return {voice,text,interim,messages,states,result,get current(){return current;},get starts(){return starts;},get stops(){return stops;}};
}
test('microphone does not start before explicit action; Korean recognition and final-only append',()=>{
 const h=harness();assert.equal(h.starts,0);h.voice.start();assert.equal(h.starts,1);assert.equal(h.current.lang,'ko-KR');assert.equal(h.current.continuous,true);
 h.current.onresult({resultIndex:0,results:[h.result('아직 인식 중',false)]});assert.equal(h.text.length,0);assert.equal(h.interim.at(-1),'아직 인식 중');
 h.current.onresult({resultIndex:0,results:[h.result('고객 설문을 분류했습니다.',true)]});h.current.onresult({resultIndex:0,results:[h.result('고객 설문을 분류했습니다.',true),h.result('기준표도 만들었습니다.',true)]});
 assert.deepEqual(h.text,['고객 설문을 분류했습니다.','기준표도 만들었습니다.']);assert.equal(h.voice.start(),false);h.voice.stop({discard:true});
});
test('stopping can accept final speech; discard ignores late events and never restarts',()=>{
 const h=harness();h.voice.start();h.voice.stop();h.current.onresult({resultIndex:0,results:[h.result('마지막 문장',true)]});h.current.onend();assert.equal(h.voice.active,false);assert.equal(h.text[0],'마지막 문장');assert.equal(h.starts,1);
 h.voice.start();const previous=h.current;h.voice.stop({discard:true});previous.onresult({resultIndex:0,results:[h.result('전송 후 늦게 도착한 문장',true)]});assert.equal(h.text.length,1);assert.equal(h.voice.active,false);
});
test('permission/network failures preserve text and explain keyboard fallback; unsupported never opens mic',()=>{
 for(const error of ['not-allowed','network','no-speech','audio-capture']){const h=harness();h.voice.start();h.current.onerror({error});assert.equal(h.voice.active,false);assert(h.messages.at(-1).length>10);assert.equal(h.starts,1);}
 let message='';const voice=createVoiceInput({Recognition:null,onText:()=>assert.fail(),onMessage:m=>message=m});assert.equal(voice.supported,false);assert.equal(voice.start(),false);assert(message.includes('지원하지'));
});
