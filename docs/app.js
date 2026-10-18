import {ROLES,CRITERIA,QUESTION,workPrompt,validateInput} from './core.mjs';
const $=id=>document.getElementById(id);
let mode='example',example,results={},history=[],controller=null,busy=false,ready=false,model=null,shownInput=null;
const status=t=>{$('feedback-status').textContent=t;};
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function fields(){return {job:$('job').value,facts:$('facts').value,question:$('question').value,answer:$('answer').value};}
function renderAgents(states={}){
  $('agent-grid').replaceChildren();
  for(const role of ROLES){
    const card=make('article',undefined,'agent-card');card.setAttribute('aria-label',role.name+' 평가');
    const top=make('div',undefined,'agent-top');top.append(make('span',role.initial,'avatar'));const title=make('div');title.append(make('h3',role.name),make('div',role.tag,'tag'));top.append(title);card.append(top);
    const r=results[role.id];
    if(!r){card.append(make('p',states[role.id]||'답변을 기다리고 있습니다.','empty'));}
    else if(r.error){card.append(make('p',r.error,'error'));}
    else {
      card.append(make('p',mode==='example'?'기록된 Work 평가':'API 평가 완료','state'));
      const score=make('p',undefined,'score');score.append(document.createTextNode(r.total+' '),make('small','/ 20점'));card.append(score);
      const criteria=make('div',undefined,'criteria');r.scores.forEach((n,i)=>{const row=make('div',undefined,'criterion');row.append(make('span',CRITERIA[i]),make('strong',n+' / 4'));criteria.append(row);});card.append(criteria);
      card.append(make('div',r.quote?'답변에서 본 근거':'평가 근거','detail-label'));
      if(r.quote)card.append(make('blockquote',r.quote));
      card.append(make('p',r.reason,'detail'),make('div','이번에 고칠 점','detail-label'),make('p',r.improvement,'detail'),make('div','꼬리질문','detail-label'),make('p',r.followup,'detail'));
      if(mode==='live'){const select=make('button','이 꼬리질문 선택','secondary');select.addEventListener('click',()=>{$('next-question').textContent=r.followup;$('next-step').hidden=false;status(role.name+'의 꼬리질문을 선택했습니다. 이어서 연습 버튼을 누르세요.');});card.append(select);}
    }
    $('agent-grid').append(card);
  }
}
function updateCount(){$('answer-count').textContent=$('answer').value.length.toLocaleString()+' / 5,000자';}
function updatePrompt(){$('prompt-view').value=workPrompt($('job').value,$('facts').value);}
function nextStep(){
  const r=ROLES.map(x=>results[x.id]).find(x=>x&&!x.error);
  $('next-step').hidden=!r;if(r)$('next-question').textContent=r.followup;
  $('use-next').hidden=mode!=='live';
}
function addHistory(input,kind){
  history.push({input:structuredClone(input),results:structuredClone(results),kind,at:new Date().toISOString(),model:kind==='API'?model:null});
  $('history-section').hidden=false;$('export').disabled=false;
  const row=make('tr');row.append(make('td',String(history.length)));
  for(const role of ROLES)row.append(make('td',results[role.id]?.total===undefined?'미완료':results[role.id].total+'점'));
  row.append(make('td',kind));$('history').append(row);
}
function clearResult(){results={};shownInput=null;renderAgents();$('next-step').hidden=true;}
function editableChanged(){
  updateCount();updatePrompt();
  if(shownInput){clearResult();status('입력이 달라져 이전 결과를 숨겼습니다. 이전 기록은 내보내기에 남아 있습니다.');}
}
function setBusy(value){
  busy=value;
  for(const el of document.querySelectorAll('button,textarea,input'))el.disabled=value;
  $('cancel').disabled=false;$('cancel').hidden=!value;
  $('export').disabled=value||!history.length;
  $('evaluate').disabled=value||!ready;
}
async function setMode(value){
  if(busy)return;if(history.some(h=>h.kind==='API')&&!confirm('모드를 바꾸면 현재 평가 기록이 지워집니다. 필요하면 먼저 내보내 주세요. 계속할까요?'))return;mode=value;clearResult();history=[];$('history').replaceChildren();$('history-section').hidden=true;$('export').disabled=true;
  for(const m of ['example','work','live'])$('mode-'+m).setAttribute('aria-pressed',String(m===mode));
  $('work-tools').hidden=mode!=='work';$('work-guide').hidden=mode!=='work';$('practice-panel').hidden=mode==='work';$('live-settings').hidden=mode!=='live';$('example-tools').hidden=mode!=='example';$('evaluate').hidden=mode!=='live';
  for(const id of ['job','facts','question','answer'])$(id).readOnly=mode==='example';
  $('mode-note').textContent={example:'실제로 진행한 가상 지원자의 Work 실습 기록입니다. 예제 버튼은 새 AI 평가를 실행하지 않습니다.',work:'내 공고와 경험으로 시작 요청문을 만들고 ChatGPT Work에서 실제 서브에이전트 3개를 실행합니다. 이 페이지는 Work 대화를 자동으로 읽지 않습니다.',live:'본인 PC의 서버에서 역할별 API 요청 3개를 병렬 실행합니다. API 비용은 ChatGPT 구독과 별개이며, 제출할 때만 전송합니다.'}[mode];
  status(mode==='example'?'‘첫 답변 보기’를 눌러 실습 결과를 확인하세요.':mode==='work'?'공고·경험을 바꾸고 요청문을 복사하세요.':'공고·경험·질문·답변을 입력하고 전송 동의를 확인하세요.');
  if(mode==='live'){
    ready=false;$('evaluate').disabled=true;
    if(!['127.0.0.1','localhost'].includes(location.hostname)){$('connection-state').textContent='공개 페이지는 예제·Work 요청문용입니다. 실제 API 평가는 README의 로컬 실행을 이용하세요.';return;}
    try{const r=await fetch('/api/config');if(!r.ok)throw Error();const cfg=await r.json();ready=cfg.ready;model=cfg.model;$('connection-state').textContent=ready?'로컬 서버 연결됨 · 모델 '+model:'서버 연결됨 · API 키와 모델 설정 필요';}
    catch{$('connection-state').textContent='로컬 서버가 연결되지 않았습니다. README의 실행 순서를 확인하세요.';}
    $('evaluate').disabled=!ready;
  }
  updatePrompt();
}
function showExample(index){
  const round=example.rounds[index];$('job').value=example.job;$('facts').value=example.facts;$('question').value=example.question;$('answer').value=round.answer;
  results=Object.fromEntries(round.results.map(r=>[r.role,r]));shownInput=fields();renderAgents();nextStep();updateCount();addHistory(shownInput,'Work 기록');
  status((index===0?'첫 답변':'수정 답변')+'의 기록된 결과입니다. 가상 사례이며 새 AI 호출은 없습니다.');
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=make('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function evaluate(){
  if(busy)return;
  if(!$('consent').checked){status('입력 전송과 API 호출 비용 동의를 먼저 확인해 주세요.');$('consent').focus();return;}
  let input;try{input=validateInput(fields());}catch(e){status(e.message);return;}
  const prior=history.at(-1);
  if(prior&&['job','facts','question'].some(k=>prior.input[k]!==input[k])){history=[];$('history').replaceChildren();$('history-section').hidden=true;}
  clearResult();shownInput=input;setBusy(true);controller=new AbortController();
  const pending=Object.fromEntries(ROLES.map(r=>[r.id,'평가 중 · 다른 역할의 결과는 전달하지 않습니다.']));renderAgents(pending);status('세 평가를 요청했습니다. 결과가 도착한 역할부터 표시합니다.');
  try{
    const r=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(input),signal:controller.signal});
    if(!r.ok){let msg='서버 요청이 실패했습니다.';try{msg=(await r.json()).error||msg;}catch{}throw Error(msg);}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',doneSeen=false;
    const event=line=>{if(!line.trim())return;const msg=JSON.parse(line);if(msg.type==='result')results[msg.result.role]=msg.result;if(msg.type==='error')results[msg.role]={error:msg.error};if(msg.type==='done')doneSeen=true;renderAgents(pending);};
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let n;while((n=buffer.indexOf('\n'))>=0){event(buffer.slice(0,n));buffer=buffer.slice(n+1);}if(done)break;}
    if(buffer.trim())event(buffer);
    if(!doneSeen)throw Error('연결이 끝나 일부 평가가 도착하지 않았습니다.');
    const completed=ROLES.filter(r=>results[r.id]&&!results[r.id].error).length;status(completed+'개 평가 완료. 실패 항목은 자동 재시도하지 않았습니다.');
  }catch(e){status(e.name==='AbortError'?'평가를 중단했습니다. 이미 사용한 API 비용은 발생할 수 있습니다.':e.message);}
  finally{
    for(const role of ROLES)if(!results[role.id])results[role.id]={error:'완료되지 않았습니다. 자동 재요청하지 않았습니다.'};
    renderAgents();nextStep();addHistory(input,'API');setBusy(false);controller=null;
  }
}
for(const m of ['example','work','live'])$('mode-'+m).addEventListener('click',()=>setMode(m));
for(const id of ['job','facts','question','answer'])$(id).addEventListener('input',editableChanged);
$('first-example').addEventListener('click',()=>showExample(0));$('second-example').addEventListener('click',()=>showExample(1));
$('copy-work').addEventListener('click',async()=>{updatePrompt();try{await navigator.clipboard.writeText($('prompt-view').value);status('요청문을 복사했습니다. ChatGPT에서 Work를 선택해 붙여 넣으세요.');}catch{$('prompt-view').parentElement.open=true;$('prompt-view').focus();$('prompt-view').select();status('자동 복사를 사용할 수 없습니다. 펼친 요청문을 직접 복사하거나 TXT로 내려받으세요.');}});
$('download-work').addEventListener('click',()=>{updatePrompt();download('work-interview-start.txt',$('prompt-view').value,'text/plain;charset=utf-8');});
$('export').addEventListener('click',()=>download('interview-session.json',JSON.stringify({version:1,notice:'면접 연습 기록. 실제 채용 점수나 합격률이 아님.',history},null,2),'application/json'));
$('evaluate').addEventListener('click',evaluate);$('cancel').addEventListener('click',()=>controller?.abort());
$('use-next').addEventListener('click',()=>{$('question').value=$('next-question').textContent;$('answer').value='';clearResult();updateCount();$('answer').focus();status('이 꼬리질문에 답변해 보세요. 제출하기 전에는 추가 호출하지 않습니다.');});
$('reset').addEventListener('click',()=>{if(busy)return;if(!confirm('이 탭의 입력과 연습 기록을 지울까요? 내보내지 않은 내용은 복구할 수 없습니다.'))return;for(const id of ['job','facts','answer'])$(id).value='';$('question').value=QUESTION;history=[];$('history').replaceChildren();$('history-section').hidden=true;$('export').disabled=true;clearResult();updateCount();updatePrompt();status('입력과 기록을 지웠습니다. 예제는 ‘첫 답변 보기’에서 다시 열 수 있습니다.');});
window.addEventListener('beforeunload',e=>{if(busy||(mode!=='example'&&$('answer').value.trim())){e.preventDefault();e.returnValue='';}});
try{const r=await fetch('example.json');if(!r.ok)throw Error();example=await r.json();$('job').value=example.job;$('facts').value=example.facts;$('question').value=example.question;await setMode('example');}
catch{status('예제 파일을 불러오지 못했습니다. HTTP 서버나 GitHub Pages에서 열어 주세요.');renderAgents();$('first-example').disabled=true;$('second-example').disabled=true;}
