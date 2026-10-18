import {ROLES,CRITERIA,QUESTION,validateInput} from './core.mjs';
import {roomView} from './room-state.mjs';
import {actorStates} from './game-state.mjs';
import {DOCUMENT_LIMITS,validateDocuments,validateQuestionInput} from './document-core.mjs';
import {createVoiceInput} from './voice.mjs?v=0.5.1';
import {overallGrade,GRADE_TIERS} from './grade.mjs?v=0.6.0';
const $=id=>document.getElementById(id);
let mode='example',example,results={},history=[],controller=null,busy=false,ready=false,model=null,shownInput=null;
let speaker='hr',exampleIndex=null;
const localApp=['127.0.0.1','localhost'].includes(location.hostname);
let connection=null,leavingForAuth=false;
let documents=[],documentQuestions=[],task='evaluation';
let stage='prepare',liveDraft=null;
$('mode-example').disabled=true;
let motion=true,previewStep=null,previewTimers=[];
function stopPreview(){previewTimers.forEach(clearTimeout);previewTimers=[];previewStep=null;}
const status=t=>{$('feedback-status').textContent=t;$('prepare-status').textContent=t;};
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const overallPanel=make('section',undefined,'grade-summary');overallPanel.id='overall-grade';overallPanel.hidden=true;overallPanel.setAttribute('aria-labelledby','overall-grade-heading');$('feedback-panel').before(overallPanel);
const gradeLive=make('p',undefined,'sr-only');gradeLive.setAttribute('role','status');gradeLive.setAttribute('aria-live','polite');overallPanel.before(gradeLive);
const historyHeading=make('th','종합 등급');$('history').closest('table').querySelector('thead tr').children[4].before(historyHeading);
let overallKey='';
function renderOverall(){
  const grade=overallGrade(results),evaluating=busy&&task==='evaluation';
  const key=JSON.stringify([mode,evaluating,grade,Object.keys(results).length]);if(key===overallKey)return;overallKey=key;
  overallPanel.hidden=!evaluating&&!Object.keys(results).length;overallPanel.replaceChildren();
  if(overallPanel.hidden){gradeLive.textContent='';return;}
  if(evaluating||grade.status!=='complete'){
    overallPanel.removeAttribute('data-grade');overallPanel.style.removeProperty('--rank-color');overallPanel.style.removeProperty('--rank-surface');
    const title=make('h2',evaluating?'종합 등급을 준비하고 있습니다':'종합 등급 보류');title.id='overall-grade-heading';overallPanel.append(title,make('p',grade.completed+' / 3개 평가 확인 · 세 평가가 모두 끝나야 등급을 매깁니다.','grade-pending'));
    if(!evaluating){overallPanel.append(make('p','실패하거나 누락된 평가는 F등급으로 계산하지 않습니다.','helper'));gradeLive.textContent='종합 등급 보류. 세 평가가 모두 완료되지 않았습니다.';}return;
  }
  const {tier}=grade;overallPanel.dataset.grade=tier.label;overallPanel.style.setProperty('--rank-color',tier.color);overallPanel.style.setProperty('--rank-surface',tier.surface);
  const layout=make('div',undefined,'grade-hero'),medal=make('div',undefined,'rank-medallion');medal.setAttribute('role','img');medal.setAttribute('aria-label','이번 답변 '+tier.label+' 등급');medal.append(make('span',tier.label,'grade-letter'),make('span','이번 답변','grade-seal'));
  const body=make('div',undefined,'grade-body'),title=make('h2',mode==='example'?'기록된 예제의 종합 등급':'이번 답변 종합 등급');title.id='overall-grade-heading';
  const points=make('p',undefined,'grade-points');points.append(make('strong',grade.percentage.toLocaleString('ko-KR',{maximumFractionDigits:1})),make('span',' / 100점'));
  body.append(title,make('p',tier.title,'grade-verdict'),points,make('p','원점수 '+grade.total+' / 60점 · 인사·현업·팀장 동일 가중치','grade-basis'));
  const rail=make('ol',undefined,'grade-rail');rail.setAttribute('aria-label','높은 순서의 전체 등급');for(const t of GRADE_TIERS){const step=make('li',t.label);if(t.label===tier.label){step.setAttribute('aria-current','step');step.setAttribute('aria-label','현재 등급 '+t.label);}rail.append(step);}body.append(rail);layout.append(medal,body);overallPanel.append(layout);
  const breakdown=make('div',undefined,'grade-breakdown');for(const c of grade.criteria){const cell=make('div');cell.append(make('span',c.name),make('strong',c.total+' / 12'));breakdown.append(cell);}overallPanel.append(breakdown);
  const rules=make('details',undefined,'grade-rules');rules.append(make('summary','등급 산정 기준 보기'),make('p','세 역할의 20점 만점 점수를 합산해 100점으로 환산합니다. 등급은 반올림 전 값으로 판정합니다. 이 앱의 연습 기준이며, 실제 채용 등급·합격률·지원자 순위가 아닙니다.'));
  const table=make('table'),caption=make('caption','앱 기준 answer-rank-v1'),head=make('thead'),headrow=make('tr');for(const text of ['등급','100점 환산 구간'])headrow.append(make('th',text));head.append(headrow);table.append(caption,head);const rows=make('tbody');GRADE_TIERS.forEach((t,i)=>{const row=make('tr');row.append(make('th',t.label),make('td',t.min+'점 이상'+(i?' '+GRADE_TIERS[i-1].min+'점 미만':'')));rows.append(row);});table.append(rows);rules.append(table);overallPanel.append(rules,make('p','사람의 능력이나 합격 가능성이 아닌, 이번 답변에 대한 연습 등급입니다.','grade-disclaimer'));
  gradeLive.textContent=(mode==='example'?'기록된 예제. ':'')+'종합 '+tier.label+' 등급, '+grade.percentage+'점. '+grade.total+' / 60점.';
}
function fields(){return {job:$('job').value,facts:$('facts').value||(documents.length?'별도 경험 메모 없음. 첨부 서류의 업무 경험을 참고하세요.':'별도 경험 메모가 제공되지 않았습니다. 답변 이외의 경험 사실을 가정하지 마세요.'),question:$('question').value,answer:$('answer').value,...(mode==='live'&&documents.length?{documents:documents.map(({name,text})=>({name,text}))}:{})};}
function openSettings(){const dialog=$('settings-dialog');if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}}
function closeSettings(){const dialog=$('settings-dialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
function setStage(next,{focus=true}={}){
  stopPreview();
  if(next==='prepare')voice.stop({discard:true});stage=next;document.body.dataset.stage=stage;
  $('entry-panel').hidden=stage!=='prepare';$('practice-panel').hidden=stage!=='interview';$('mode-live').hidden=stage==='prepare'&&mode==='live';
  $('session-job').textContent=$('job').value.trim().split('\n')[0]||'나의 면접';
  $('session-documents').textContent=mode==='example'?'가상 지원자의 기록된 예제':documents.length?documents.map(d=>d.name).join(' · '):'기본 질문으로 연습';
  $('room-question').value=$('question').value;updateTools();renderRoom();
  if(focus){const target=stage==='interview'?$('dialogue-question'):$('entry-heading');target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'auto'});}
}
async function startInterview(){
  if(busy)return;
  if(!localApp){status('실제 면접은 GitHub에서 내려받아 PC에서 실행해 주세요. 기록된 예제는 아래에서 둘러볼 수 있습니다.');return;}
  if(!$('job').value.trim()){status('준비할 직무나 지원 공고를 먼저 적어 주세요.');$('job').focus();return;}
  if(!requirePlan())return;
  if(documents.length){
    try{validateQuestionInput(fields());}catch(e){status(e.message);return;}
    if(documentQuestions.some(q=>q.question===$('question').value)&&$('answer').value.trim()){setStage('interview');status('작성하던 답변에서 이어서 연습합니다.');return;}
    if(!documentQuestions.length&&!(await askFromDocuments()))return;
    selectDocumentQuestion(documentQuestions.find(q=>q.role==='hr')||documentQuestions[0]);
  }else{clearResult();setStage('interview');status('첫 질문입니다. 준비되면 말하거나 직접 입력해 주세요.');}
}
function renderRoom(){
  const evaluating=busy&&task==='evaluation';
  const v=roomView({speaker,question:$('question').value,results,busy:evaluating,answerLoaded:!!$('answer').value.trim(),exampleMode:mode==='example'});
  $('dialogue-speaker').textContent=v.speaker;$('dialogue-kind').textContent=v.kind;$('dialogue-question').textContent=v.text;$('room-state').textContent=v.state;
  if(busy&&task!=='evaluation')$('room-state').textContent=task==='questions'?'서류 질문 준비 중':'서류 읽는 중';
  for(const el of document.querySelectorAll('[data-speaker]'))el.setAttribute('aria-pressed',String(el.dataset.speaker===v.role));
  if(voice.active)$('room-state').textContent=voice.phase==='connecting'?'마이크 연결 요청 중':voice.phase==='stopping'?'답변 정리 중':'답변을 듣고 있습니다';
  $('feedback-summary').textContent=Object.keys(results).length?'평가 근거와 다음에 고칠 문장을 읽어보세요.':'답변 뒤에 근거·보완점·꼬리질문을 확인합니다.';
  renderGame(evaluating);
}
function renderGame(evaluating){
  const preview=previewStep!==null;
  const visualResults=preview?Object.fromEntries(['hr','lead','practitioner'].slice(0,previewStep).map(id=>[id,{}])):results;
  const actors=actorStates({speaker,results:visualResults,evaluating:preview?previewStep<3:evaluating,listening:voice.active,answerLoaded:!!$('answer').value.trim()});
  const scene=$('game-scene');scene.dataset.motion=motion?'on':'off';scene.dataset.speaker=speaker;
  for(const el of scene.querySelectorAll('[data-actor]')){
    const state=actors[el.dataset.actor];if(el.dataset.pose!==state.pose)el.dataset.pose=state.pose;
    el.setAttribute('aria-label',el.dataset.name+' · '+state.label+' · 선택');
    el.querySelector('.actor-status').textContent=state.label;
  }
  $('candidate-bubble').hidden=!voice.active;$('candidate-bubble').textContent=voice.phase==='connecting'?'마이크 연결 중':voice.phase==='stopping'?'답변 정리 중':'답변 중';
  $('game-preview').hidden=mode!=='example';$('game-preview').disabled=busy||preview;
  $('scene-caption').textContent=preview?'연출 미리보기 · AI 호출 없음 · 점수에 반영되지 않습니다.':evaluating?'검토 동작은 화면 연출입니다. 세 평가는 서로 결과를 전달하지 않습니다.':Object.keys(results).length?'캐릭터를 선택하면 그 면접관의 꼬리질문을 볼 수 있습니다.':'말풍선 아래 면접관이 질문합니다. 준비되면 말하거나 입력하세요.';
  $('scene-result').hidden=preview||evaluating||!Object.keys(results).length;
  $('motion-toggle').disabled=false;$('motion-toggle').setAttribute('aria-pressed',String(motion));$('motion-toggle').textContent=motion?'동작 끄기':'동작 켜기';
  if(preview){$('dialogue-speaker').textContent='동작 미리보기';$('dialogue-kind').textContent='AI 호출 없음';$('dialogue-question').textContent=previewStep===3?'세 면접관의 완료 반응입니다. 실제 평가 결과는 바뀌지 않습니다.':'답변을 제출하면 각 면접관이 이렇게 검토합니다. 결과가 도착한 면접관부터 완료 반응으로 바뀝니다.';$('room-state').textContent='연출 미리보기';}
}
$('motion-toggle').addEventListener('click',()=>{motion=!motion;renderRoom();});
$('scene-result').addEventListener('click',()=>{overallPanel.scrollIntoView({block:'start',behavior:motion?'smooth':'auto'});$('overall-grade-heading')?.setAttribute('tabindex','-1');$('overall-grade-heading')?.focus({preventScroll:true});});
$('game-preview').addEventListener('click',()=>{
  if(busy)return;stopPreview();previewStep=0;renderRoom();
  for(let step=1;step<=3;step++)previewTimers.push(setTimeout(()=>{previewStep=step;renderRoom();},step*1600));
  previewTimers.push(setTimeout(()=>{stopPreview();renderRoom();},6600));
});
function renderAgents(states={}){
  $('agent-grid').replaceChildren();
  for(const role of ROLES){
    const card=make('article',undefined,'agent-card'+(role.id===speaker?' selected':''));card.setAttribute('aria-label',role.name+' 평가');
    const top=make('div',undefined,'agent-top');top.append(make('span',role.initial,'avatar'));const title=make('div');title.append(make('h3',role.name),make('div',role.tag,'tag'));top.append(title);card.append(top);
    const r=results[role.id];
    if(!r){card.append(make('p',states[role.id]||'답변을 기다리고 있습니다.','empty'));}
    else if(r.error){card.append(make('p',r.error,'error'));}
    else {
      card.append(make('p',mode==='example'?'기록된 실습 평가':'ChatGPT 구독 평가 완료','state'));
      const score=make('p',undefined,'score');score.append(document.createTextNode(r.total+' '),make('small','/ 20점'));card.append(score);
      const criteria=make('div',undefined,'criteria');r.scores.forEach((n,i)=>{const row=make('div',undefined,'criterion');row.append(make('span',CRITERIA[i]),make('strong',n+' / 4'));criteria.append(row);});card.append(criteria);
      card.append(make('div',r.quote?'답변에서 본 근거':'평가 근거','detail-label'));
      if(r.quote)card.append(make('blockquote',r.quote));
      card.append(make('p',r.reason,'detail'),make('div','이번에 고칠 점','detail-label'),make('p',r.improvement,'detail'),make('div','꼬리질문','detail-label'),make('p',r.followup,'detail'));
      if(mode==='live'){const select=make('button','이 꼬리질문 선택','secondary');select.addEventListener('click',()=>{$('next-question').textContent=r.followup;$('next-step').hidden=false;status(role.name+'의 꼬리질문을 선택했습니다. 이어서 연습 버튼을 누르세요.');});card.append(select);}
    }
    $('agent-grid').append(card);
  }
  renderRoom();
  renderOverall();
}
function updateCount(){$('answer-count').textContent=$('answer').value.length.toLocaleString()+' / 5,000자';updateTools();}
function nextStep(){
  const r=ROLES.map(x=>results[x.id]).find(x=>x&&!x.error);
  $('next-step').hidden=!r;if(r)$('next-question').textContent=r.followup;
  $('use-next').hidden=mode!=='live';
}
function addHistory(input,kind){
  history.push({input:structuredClone(input),results:structuredClone(results),overall:overallGrade(results),kind,at:new Date().toISOString(),model:kind==='ChatGPT 구독'?model:null});
  $('history-section').hidden=false;$('export').disabled=false;
  const row=make('tr');row.append(make('td',String(history.length)));
  for(const role of ROLES)row.append(make('td',results[role.id]?.total===undefined?'미완료':results[role.id].total+'점'));
  const grade=overallGrade(results),rank=make('td',grade.status==='complete'?grade.tier.label:'보류');if(grade.status==='complete'){rank.className='history-rank';rank.style.color=grade.tier.color;}row.append(rank,make('td',kind));$('history').append(row);
}
function clearResult(){stopPreview();results={};shownInput=null;$('feedback-panel').open=false;renderAgents();$('next-step').hidden=true;}
function editableChanged(){
  updateCount();
  if(shownInput){clearResult();status('입력이 달라져 이전 결과를 숨겼습니다. 이전 기록은 내보내기에 남아 있습니다.');}
  renderRoom();
}
function setBusy(value,kind='evaluation'){
  if(value)voice.stop({discard:true});busy=value;task=kind;
  for(const el of document.querySelectorAll('button,textarea,input,select'))el.disabled=value;
  $('cancel').disabled=false;$('cancel').hidden=!value;
  $('cancel-preparation').disabled=false;$('cancel-preparation').hidden=!value||stage!=='prepare';
  $('cancel').hidden=!value||stage!=='interview';$('close-settings').disabled=false;
  $('operation-status').hidden=!value;$('operation-status').textContent=value?(kind==='reading'?'PC에서 서류를 읽고 있습니다.':kind==='questions'?'서류에 근거한 면접 질문을 준비하고 있습니다.':'세 관점에서 답변을 평가하고 있습니다.'):'';
  $('export').disabled=value||!history.length;
  updateEvaluateAvailability();
  if(!value){$('auth-start').disabled=!localApp;$('auth-refresh').disabled=!localApp;$('auth-logout').disabled=!connection?.connected;$('model-select').disabled=!ready;}
  updateTools();
  renderRoom();
  renderOverall();
}
async function setMode(value){
  if(busy)return;if(mode!==value&&history.length&&!confirm('예제를 전환하면 현재 평가 기록이 지워집니다. 먼저 내보낼 수 있습니다. 계속할까요?'))return;
  if(mode==='live'&&value==='example')liveDraft=Object.fromEntries(['job','facts','question','answer'].map(k=>[k,$(k).value]));
  if(mode==='example'&&value==='live'&&liveDraft)for(const k of ['job','facts','question','answer'])$(k).value=liveDraft[k]||'';
  voice.stop({discard:true});mode=value;clearResult();history=[];$('history').replaceChildren();$('history-section').hidden=true;$('export').disabled=true;
  $('example-tools').hidden=mode!=='example';$('example-feedback').hidden=mode!=='example';$('example-feedback').disabled=true;exampleIndex=null;$('setup-panel').open=false;
  invalidateQuestions();
  $('documents-panel').hidden=mode!=='live';$('voice-tools').hidden=mode!=='live';
  for(const id of ['job','facts','question','answer'])$(id).readOnly=mode==='example';
  $('room-question').readOnly=mode==='example';
  $('mode-note').textContent=localApp?'본인 PC에서 내 ChatGPT 구독으로 연습합니다. 입력·첨부·결과는 새로고침하면 사라집니다.':'이 웹 주소는 예제판입니다. 실제 면접은 GitHub에서 내려받아 PC에서 실행해 주세요.';
  $('mode-note').hidden=localApp;
  if(mode==='live'){await refreshConnection();if(mode!==value)return;setStage('prepare',{focus:false});status('직무와 서류를 준비한 뒤 면접을 시작하세요.');}
  else{loadExample(0);setStage('interview');status('가상 지원자의 기록된 예제입니다. 새 AI 요청 없이 답변과 기록된 평가를 확인합니다.');}
  updateTools();
  renderRoom();
}
function loadExample(index){
  clearResult();exampleIndex=index;const round=example.rounds[index];
  $('job').value=example.job;$('facts').value=example.facts;$('question').value=example.question;$('answer').value=round.answer;
  updateCount();renderRoom();$('example-feedback').disabled=false;
  $('answer-review').open=true;
  status((index===0?'첫 답변':'수정 답변')+'을 불러왔습니다. 읽어본 뒤 ‘기록된 평가 펼치기’를 누르세요. 새 AI 호출은 없습니다.');
}
function showExample(index){
  const round=example.rounds[index];$('job').value=example.job;$('facts').value=example.facts;$('question').value=example.question;$('answer').value=round.answer;
  results=Object.fromEntries(round.results.map(r=>[r.role,r]));shownInput=fields();renderAgents();nextStep();updateCount();addHistory(shownInput,'Work 기록');
  status((index===0?'첫 답변':'수정 답변')+'의 기록된 결과입니다. 가상 사례이며 새 AI 호출은 없습니다.');
  $('feedback-panel').open=true;
  $('game-scene').scrollIntoView({block:'start',behavior:'auto'});
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=make('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function evaluate(){
  if(busy)return;
  voice.stop({discard:true});if(!requirePlan())return;
  let input;try{input=validateInput(fields());}catch(e){status(e.message);return;}
  const prior=history.at(-1);
  if(prior&&['job','facts','question','documents'].some(k=>JSON.stringify(prior.input[k])!==JSON.stringify(input[k]))){history=[];$('history').replaceChildren();$('history-section').hidden=true;}
  clearResult();shownInput=input;setBusy(true);controller=new AbortController();
  const pending=Object.fromEntries(ROLES.map(r=>[r.id,'구독 평가 중 · 다른 역할의 결과는 전달하지 않습니다.']));renderAgents(pending);status('내 구독으로 세 평가를 요청했습니다. 결과가 도착한 역할부터 표시합니다.');
  try{
    const r=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify({...input,model:$('model-select').value}),signal:controller.signal});
    if(!r.ok){let msg='서버 요청이 실패했습니다.';try{msg=(await r.json()).error||msg;}catch{}throw Error(msg);}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',doneSeen=false;
    const event=line=>{if(!line.trim())return;const msg=JSON.parse(line);if(msg.type==='result')results[msg.result.role]=msg.result;if(msg.type==='error')results[msg.role]={error:msg.error};if(msg.type==='done')doneSeen=true;renderAgents(pending);};
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let n;while((n=buffer.indexOf('\n'))>=0){event(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(done)break;}
    if(buffer.trim())event(buffer);
    if(!doneSeen)throw Error('연결이 끝나 일부 평가가 도착하지 않았습니다.');
    const completed=ROLES.filter(r=>results[r.id]&&!results[r.id].error).length;status(completed+'개 평가 완료. 실패 항목은 자동 재시도하지 않았습니다.');
  }catch(e){status(e.name==='AbortError'?'평가를 중단했습니다. 이미 소모된 구독 사용량은 되돌릴 수 없습니다.':e.message);}
  finally{
    for(const role of ROLES)if(!results[role.id])results[role.id]={error:'완료되지 않았습니다. 자동 재요청하지 않았습니다.'};
    renderAgents();nextStep();addHistory(input,'ChatGPT 구독');setBusy(false);controller=null;$('feedback-panel').open=true;
  }
}
function requirePlan(){
  if(!localApp||!ready||!$('model-select').value){status('먼저 ChatGPT를 연결하고 사용할 모델을 선택해 주세요.');openSettings();(ready?$('model-select'):$('auth-start')).focus();return false;}
  if(!$('consent').checked){setStage('prepare',{focus:false});status('전송할 본문과 구독 사용량 안내를 확인하고 동의해 주세요.');$('consent').focus();return false;}
  return true;
}
function updateTools(){
  $('generate-questions').disabled=busy||!localApp||!documents.length;
  $('document-files').disabled=busy||!localApp||mode!=='live';
  $('start-interview').disabled=busy;
  $('voice-start').disabled=busy||!voice.supported||voice.active||mode!=='live'||stage!=='interview';
  $('voice-start').hidden=voice.active;
  $('voice-start').classList.toggle('secondary-emphasis',!!$('answer').value.trim());
  $('voice-stop').disabled=busy;
  $('type-answer').hidden=mode!=='live';
  const keyboardPrimary=!voice.supported&&!$('answer').value.trim();$('type-answer').classList.toggle('primary',keyboardPrimary);$('type-answer').classList.toggle('text-button',!keyboardPrimary);
  updateEvaluateAvailability();
}
function invalidateQuestions(){documentQuestions=[];$('question-bank').replaceChildren();$('question-bank').hidden=true;$('consent').checked=false;}
function renderDocuments(){
  $('document-count').textContent='첨부 '+documents.length+' / 3';$('document-list').replaceChildren();
  for(const doc of documents){
    const details=make('details',undefined,'document-preview'),summary=make('summary',doc.name+' · '+doc.text.length.toLocaleString()+'자');details.append(summary);
    const content=make('div',undefined,'document-body');for(const note of doc.notes||[])content.append(make('p',note,'helper'));
    const label=make('label','AI에 보낼 본문 — 개인정보·누락을 확인하고 수정하세요.');const area=make('textarea');area.value=doc.text;area.rows=7;area.maxLength=DOCUMENT_LIMITS.characters;area.setAttribute('aria-label',doc.name+' 본문 미리보기·수정');
    area.addEventListener('input',()=>{doc.text=area.value;summary.textContent=doc.name+' · '+doc.text.length.toLocaleString()+'자';invalidateQuestions();editableChanged();});
    label.append(area);content.append(label);
    const remove=make('button','이 서류 지우기','text-button');remove.addEventListener('click',()=>{documents=documents.filter(d=>d!==doc);invalidateQuestions();renderDocuments();editableChanged();$('document-status').textContent='서류를 이 탭에서 지웠습니다. 이미 전송한 내용은 OpenAI에서 회수하지 않습니다.';});content.append(remove);details.append(content);$('document-list').append(details);
  }updateTools();
}
function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('파일을 읽지 못했습니다. 다시 선택해 주세요.'));reader.readAsDataURL(file);});}
async function attachFiles(){
  const files=Array.from($('document-files').files||[]);$('document-files').value='';if(!files.length||busy)return;
  if(documents.length+files.length>3){$('document-status').textContent='서류는 최대 3개입니다. 기존 첨부를 지운 뒤 선택해 주세요.';return;}
  if(files.some(f=>f.size>DOCUMENT_LIMITS.bytes||f.name.length>150)){$('document-status').textContent='파일당 5MiB, 파일 이름 150자까지입니다.';return;}
  controller=new AbortController();setBusy(true,'reading');
  try{
    for(const file of files){
      $('document-status').textContent=file.name+'을 PC에서 읽고 있습니다. OpenAI로 보내지 않습니다.';
      const r=await fetch('/api/documents/read',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify({name:file.name,data:await fileBase64(file)}),signal:controller.signal});
      const data=await r.json();if(!r.ok)throw Error(data.error||'파일을 읽지 못했습니다.');
      validateDocuments([...documents,data.document]);documents.push(data.document);invalidateQuestions();renderDocuments();for(const el of $('document-list').querySelectorAll('button,textarea'))el.disabled=true;
    }
    clearResult();$('document-status').textContent='서류를 읽었습니다. 파일명을 눌러 본문을 확인한 뒤 전송 동의와 ‘서류로 질문 받기’를 선택하세요.';
  }catch(e){$('document-status').textContent=e.name==='AbortError'?'서류 읽기를 중단했습니다. 이미 읽은 첨부만 남겼습니다.':e.message;}
  finally{setBusy(false);controller=null;}
}
function selectDocumentQuestion(q){
  if(!q||busy||($('answer').value.trim()&&!confirm('현재 답변을 지우고 이 질문으로 시작할까요? 필요한 답변은 먼저 내보내거나 복사해 주세요.')))return;
  voice.stop({discard:true});speaker=q.role;$('question').value=q.question;$('answer').value='';clearResult();updateCount();$('answer-review').open=false;setStage('interview');status('서류에 근거한 질문입니다. 준비되면 말하거나 직접 입력해 주세요.');
}
function renderQuestions(){
  $('question-bank').replaceChildren();$('question-bank').hidden=!documentQuestions.length;
  for(const q of documentQuestions){
    const article=make('article',undefined,'document-question');article.append(make('h3',ROLES.find(r=>r.id===q.role).name),make('p',q.question),make('p',q.intent,'question-intent'));
    const evidence=make('details');evidence.append(make('summary','근거: '+q.source),make('blockquote',q.quote));article.append(evidence);
    const choose=make('button','이 질문으로 면접 시작','secondary');choose.addEventListener('click',()=>{if(requirePlan())selectDocumentQuestion(q);});article.append(choose);$('question-bank').append(article);
  }
}
async function askFromDocuments(){
  if(busy||!requirePlan())return false;let input;try{input=validateQuestionInput(fields());}catch(e){$('document-status').textContent=e.message;status(e.message);return false;}
  controller=new AbortController();setBusy(true,'questions');$('document-status').textContent='확인한 본문으로 질문을 만들고 있습니다. 내 구독 사용량 1회 요청 · 자동 재시도 없음.';
  try{
    const r=await fetch('/api/questions',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify({...input,model:$('model-select').value}),signal:controller.signal}),data=await r.json();
    if(!r.ok)throw Error(data.error||'질문을 받지 못했습니다.');documentQuestions=data.questions;renderQuestions();$('document-status').textContent='세 역할의 질문과 서류 원문 인용을 확인했습니다. 연습할 질문을 선택하세요.';return true;
  }catch(e){const message=e.name==='AbortError'?'질문 생성을 중단했습니다. 이미 사용한 구독 사용량은 되돌릴 수 없습니다.':e.message;$('document-status').textContent=message;status(message);return false;}
  finally{setBusy(false);controller=null;}
}
const voice=createVoiceInput({Recognition:window.SpeechRecognition||window.webkitSpeechRecognition,
  onText:text=>{const area=$('answer'),joined=area.value+(area.value&&!/\s$/.test(area.value)?' ':'')+text;if(joined.length>5000){voice.stop({discard:true});$('voice-status').textContent='5,000자 한도입니다. 일부 문장을 정리한 뒤 다시 입력해 주세요.';return;}area.value=joined;editableChanged();},
  onInterim:text=>{$('voice-interim').textContent=text;},
  onState:(active,phase)=>{$('voice-stop').hidden=!active;$('voice-stop').textContent=phase==='connecting'?'연결 취소':phase==='stopping'?'답변 정리 중':'답변 마치기';$('voice-indicator').hidden=phase!=='listening';$('voice-start').setAttribute('aria-pressed',String(phase==='listening'));$('answer').classList.toggle('listening',phase==='listening');if(active)$('answer-review').open=true;updateTools();renderRoom();},
  onMessage:message=>{$('voice-status').textContent=message;}
});
if(!voice.supported)$('voice-status').textContent='이 브라우저는 음성 입력을 지원하지 않습니다. Chrome에서 열거나 키보드로 입력해 주세요.';
$('voice-start').addEventListener('click',()=>{if(busy||mode!=='live')return;if(!$('voice-consent').checked){document.querySelector('.voice-privacy').open=true;$('voice-consent').focus();$('voice-status').textContent='마이크 사용 안내를 확인하고 동의한 뒤 시작해 주세요.';return;}voice.start();});
$('voice-stop').addEventListener('click',()=>voice.stop());
$('voice-consent').addEventListener('change',()=>{if(!$('voice-consent').checked)voice.stop({discard:true});});
document.addEventListener('visibilitychange',()=>{if(document.hidden)voice.stop({discard:true});});
$('document-files').addEventListener('change',attachFiles);$('generate-questions').addEventListener('click',askFromDocuments);
for(const m of ['example','live'])$('mode-'+m).addEventListener('click',()=>{if(mode===m&&m==='live'){setStage('prepare');return;}setMode(m);});
$('start-interview').addEventListener('click',startInterview);
$('back-to-prepare').addEventListener('click',()=>{if(mode==='example')setMode('live');else setStage('prepare');});
$('open-settings').addEventListener('click',openSettings);$('close-settings').addEventListener('click',closeSettings);$('settings-done').addEventListener('click',()=>{closeSettings();if(!busy&&stage==='prepare')$('start-interview').focus();});
$('type-answer').addEventListener('click',()=>{voice.stop({discard:true});$('answer-review').open=true;$('answer').focus();});
$('room-question').addEventListener('input',()=>{$('question').value=$('room-question').value;editableChanged();});
for(const id of ['job','facts','question','answer'])$(id).addEventListener('input',editableChanged);
for(const id of ['job','facts'])$(id).addEventListener('input',invalidateQuestions);
$('first-example').addEventListener('click',()=>loadExample(0));$('second-example').addEventListener('click',()=>loadExample(1));
$('example-feedback').addEventListener('click',()=>{if(exampleIndex!==null)showExample(exampleIndex);});
for(const el of document.querySelectorAll('[data-speaker]'))el.addEventListener('click',()=>{if(busy)return;speaker=el.dataset.speaker;renderAgents();});
$('export').addEventListener('click',()=>download('interview-session.json',JSON.stringify({version:1,notice:'면접 연습 기록. 실제 채용 점수나 합격률이 아님.',history},null,2),'application/json'));
$('evaluate').addEventListener('click',evaluate);$('cancel').addEventListener('click',()=>controller?.abort());
$('cancel-preparation').addEventListener('click',()=>controller?.abort());
$('use-next').addEventListener('click',()=>{voice.stop({discard:true});$('question').value=$('next-question').textContent;$('answer').value='';clearResult();updateCount();$('answer').focus();status('이 꼬리질문에 답변해 보세요. 제출하기 전에는 추가 호출하지 않습니다.');});
$('reset').addEventListener('click',()=>{if(busy)return;if(!confirm('이 탭의 서류·입력·연습 기록을 지울까요? 내보내지 않은 내용은 복구할 수 없습니다.'))return;voice.stop({discard:true});documents=[];invalidateQuestions();renderDocuments();for(const id of ['job','facts','answer'])$(id).value='';$('question').value=QUESTION;history=[];exampleIndex=null;liveDraft=null;$('example-feedback').disabled=true;$('history').replaceChildren();$('history-section').hidden=true;$('export').disabled=true;clearResult();updateCount();if(mode==='example')setMode('live');else setStage('prepare');status('서류·입력·연습 기록을 지웠습니다.');});
function updateEvaluateAvailability(){$('evaluate').disabled=busy||!ready||!$('model-select').value;$('evaluate').hidden=mode!=='live'||stage!=='interview'||!$('answer').value.trim()||voice.active;}
async function authPost(action,data={}){const r=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(data)});const out=await r.json();if(!r.ok)throw Error(out.error||'연결 요청이 실패했습니다.');return out;}
async function refreshConnection(){
  ready=false;updateEvaluateAvailability();$('model-select').disabled=true;
  if(!localApp){$('connection-state').textContent='실제 구독 연결은 PC 실행판에서만 가능합니다. GitHub에서 내려받아 START-WINDOWS.cmd를 실행해 주세요.';$('auth-start').disabled=true;$('auth-refresh').disabled=true;return;}
  try{
    const r=await fetch('/api/config');if(!r.ok)throw Error('로컬 앱에 연결하지 못했습니다.');connection=await r.json();
    const select=$('auth-account');select.replaceChildren();for(const account of connection.accounts||[]){const option=make('option',account.label);option.value=account.id;select.append(option);}const fresh=make('option','새 ChatGPT 계정 연결');fresh.value='';select.append(fresh);select.value=connection.activeId||connection.defaultAccountId||'';
    $('auth-logout').disabled=!connection.connected;$('auth-cancel').hidden=!connection.signInPending;
    $('connection-state').textContent=connection.error||connection.notice||(connection.sharing?'구독 사용 권한 연결됨. 사용할 모델을 선택해 주세요.':connection.connected?'로그인은 됐지만 구독 사용 권한을 확인하지 못했습니다. 다시 연결해 주세요.':'로그인 전입니다. Continue with ChatGPT를 눌러 계정과 구독 사용을 허용해 주세요.');
    if(connection.sharing||connection.recoveryPending){
      const old=$('model-select').value;const mr=await fetch('/api/models');const data=await mr.json();if(!mr.ok)throw Error(data.error||'모델 목록을 불러오지 못했습니다.');
      $('model-select').replaceChildren();const placeholder=make('option','사용할 모델을 선택해 주세요.');placeholder.value='';$('model-select').append(placeholder);
      for(const m of data.models){const option=make('option',m.name);option.value=m.id;$('model-select').append(option);}
      if(data.models.some(m=>m.id===old))$('model-select').value=old;ready=data.models.length>0;$('model-select').disabled=!ready;
      if(!ready)$('connection-state').textContent='이 계정에서 사용할 모델을 받지 못했습니다. 구독·앱 권한을 확인해 주세요.';
    }else{$('model-select').replaceChildren(make('option','먼저 ChatGPT로 로그인해 주세요.'));$('model-select').value='';}
  }catch(e){$('connection-state').textContent=e.message;ready=false;}
  updateEvaluateAvailability();
}
$('model-select').addEventListener('change',()=>{model=$('model-select').value;updateEvaluateAvailability();$('connection-badge').textContent=model?'ChatGPT 연결됨 · 설정':'모델 선택 · 설정';});
$('auth-refresh').addEventListener('click',refreshConnection);
$('auth-account').addEventListener('change',async()=>{$('consent').checked=false;if(!$('auth-account').value)return;try{await authPost('select',{accountId:$('auth-account').value});await refreshConnection();}catch(e){$('connection-state').textContent=e.message;}});
$('auth-start').addEventListener('click',async()=>{
  if(!localApp||busy)return;$('auth-start').disabled=true;
  voice.stop({discard:true});if(documents.length&&!confirm('로그인 화면으로 이동하면 첨부 본문은 사라집니다. 로그인 후 다시 첨부할까요?')){$('auth-start').disabled=false;return;}
  try{const data=await authPost('start',{accountId:$('auth-account').value||null,draft:fields()});if(new URL(data.url).origin!=='https://auth.openai.com')throw Error('공식 로그인 주소가 아닙니다.');leavingForAuth=true;location.assign(data.url);}
  catch(e){$('connection-state').textContent=e.message;$('auth-start').disabled=false;}
});
$('auth-logout').addEventListener('click',async()=>{if(!confirm('이 PC에서 선택한 ChatGPT 계정의 연결을 종료할까요?'))return;try{const result=await authPost('logout');await refreshConnection();$('connection-state').textContent=result.notice;}catch(e){$('connection-state').textContent=e.message;}});
$('auth-cancel').addEventListener('click',async()=>{try{await authPost('cancel');await refreshConnection();}catch(e){$('connection-state').textContent=e.message;}});
window.addEventListener('beforeunload',e=>{voice.stop({discard:true});if(!leavingForAuth&&(busy||documents.length||(mode!=='example'&&$('answer').value.trim()))){e.preventDefault();e.returnValue='';}});
try{const r=await fetch('example.json');if(!r.ok)throw Error();example=await r.json();$('question').value=QUESTION;await setMode('live');if(localApp){const saved=await fetch('/api/draft',{headers:{'X-Interview-Client':'1'}});if(saved.ok){const {draft}=await saved.json();if(draft){for(const k of ['job','facts','question','answer'])if(typeof draft[k]==='string')$(k).value=draft[k];updateCount();renderRoom();}}}}
catch{status('예제 파일을 불러오지 못했습니다. HTTP 서버나 GitHub Pages에서 열어 주세요.');renderAgents();$('first-example').disabled=true;$('second-example').disabled=true;}
finally{$('mode-example').disabled=!example;}
