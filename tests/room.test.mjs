import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {roomView} from '../docs/room-state.mjs';
test('room begins with a question, not fabricated scores',()=>{
 const r=roomView();assert.equal(r.speaker,'인사담당자');assert.equal(r.phase,'question');assert(!('total' in r));
});
test('room speaker follows selected role without altering question',()=>{
 const r=roomView({speaker:'lead',question:'협업 사례를 설명해 주세요.'});assert.equal(r.speaker,'팀장');assert.equal(r.text,'협업 사례를 설명해 주세요.');
 assert.equal(roomView({speaker:'unknown'}).role,'hr');
});
test('loading, failure and recorded followup remain distinct',()=>{
 assert.equal(roomView({busy:true}).state,'평가 진행 중');
 assert.equal(roomView({results:{hr:{error:'실패'}}}).text,'실패');
 const r=roomView({exampleMode:true,results:{hr:{followup:'본인의 역할은 무엇인가요?'}}});assert(r.kind.includes('기록된'));assert.equal(r.phase,'feedback');
});
test('scene has three keyboard-selectable roles and real answer field; feedback is initially collapsed',async()=>{
 const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
 for(const id of ['hr','lead','practitioner'])assert(html.includes('data-speaker="'+id+'"'));
 assert(html.includes('id="answer"'));assert(html.includes('<details id="feedback-panel"'));
 assert(!/<details id="feedback-panel"[^>]*\sopen/.test(html));
 assert(html.includes('기록된 평가 펼치기'));assert(html.includes('새 AI 평가를 실행하지 않습니다.'));
});
