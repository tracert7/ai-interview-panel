// Explicit live check using only this authored fictional application.
// Does not read user documents, existing chats, auth files, environment API keys, or tokens.
if(!process.argv.includes('--run-live'))throw Error('기존 ChatGPT 구독 사용량을 소모합니다. 실행하려면 --run-live --model <모델>을 지정하세요.');
const model=process.argv[process.argv.indexOf('--model')+1];
if(!process.argv.includes('--model')||!model)throw Error('모델을 직접 지정하세요.');
const base='http://127.0.0.1:4317';
const config=await(await fetch(base+'/api/config')).json();
if(!config.ready||config.apiKeyFallback!==false)throw Error('구독 전용 로그인이 준비되지 않았습니다.');
const catalog=await(await fetch(base+'/api/models')).json();if(!catalog.models?.some(m=>m.id===model))throw Error('현재 계정에 없는 모델입니다.');
async function post(route,value){const r=await fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(value)});if(!r.ok)throw Error((await r.json()).error);return r;}
const source=`가상의 마케팅 인턴 지원서류입니다. 실제 사람·회사의 정보는 없습니다.
대학 동아리의 가상 서비스 조사에서 고객 설문 24건을 두 명이 함께 검토했습니다. 저는 반복되는 문의를 분류할 기준표를 만들고 중복 응답을 따로 표시했습니다. 팀원이 모집과 설문 수집을 맡았으며 저는 수집에 참여하지 않았습니다.
분류 결과를 표와 회의 문서로 정리하고, 의견이 다른 3건은 팀원과 원문을 다시 읽어 기준을 고쳤습니다. 방문·결제 전환 효과는 측정하지 않았기 때문에 성과 수치를 주장하지 않았습니다.
다음 프로젝트에서는 설문 설계 전 지표 정의와 분류 기준을 합의하고 검토 기록을 남기겠습니다. 이 계획은 아직 실행한 실적이 아닙니다.`;
const {document}=await(await post('/api/documents/read',{name:'가상-마케팅-지원서.txt',data:Buffer.from(source).toString('base64')})).json();
if(document.text!==source)throw Error('서류 추출 대조 실패');
const input={job:'B2B SaaS 마케팅 인턴: 고객 조사, 지표 보고서 작성, 팀 협업',facts:'아래 첨부는 자작 가상 지원서입니다.',documents:[{name:document.name,text:document.text}],model};
const started=Date.now(),questionResult=await(await post('/api/questions',input)).json();
if(questionResult.questions.length!==3)throw Error('세 질문 미완료');
for(const q of questionResult.questions)if(q.source!==document.name||!source.includes(q.quote))throw Error('질문 근거 불일치');
await new Promise(r=>setTimeout(r,3100));
const answer='고객의 반복 문의를 근거로 정리하는 일에 관심이 있어 지원했습니다. 가상 서비스 조사에서는 두 명이 설문 24건을 검토했고 저는 분류 기준표를 만들고 중복 응답을 구분했습니다. 모집과 수집은 팀원이 맡았습니다. 의견이 갈린 3건은 원문을 다시 읽고 기준을 고쳤습니다. 방문이나 결제 전환 효과는 측정하지 않아 개선했다고 말할 수 없습니다. 다음에는 조사 전에 지표와 분류 기준을 합의하겠습니다.';
const r=await post('/api/evaluate',{...input,question:questionResult.questions[0].question,answer}),events=(await r.text()).trim().split('\n').map(JSON.parse),results=events.filter(e=>e.type==='result').map(e=>e.result);
if(results.length!==3||events.some(e=>e.type==='error'))throw Error('세 평가 미완료');
for(const result of results)if(!answer.includes(result.quote)||result.total!==result.scores.reduce((a,b)=>a+b,0))throw Error('평가 대조 실패');
console.log(JSON.stringify({version:'0.4.0',provider:'chatgpt-plan',model,apiKeyFallback:false,source:'self-authored fictional application',documentCharacters:source.length,questionCount:3,questions:questionResult.questions,questionUsage:questionResult.usage,evaluations:results.map(({role,total,usage})=>({role,total,usage})),elapsedMs:Date.now()-started,browserVisualCheck:false,actualMicrophoneCheck:false},null,2));
