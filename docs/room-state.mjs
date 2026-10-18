import {ROLES,QUESTION} from './core.mjs';
export function roomView({speaker='hr',question=QUESTION,results={},busy=false,answerLoaded=false,exampleMode=false}={}) {
  const role=ROLES.find(r=>r.id===speaker)||ROLES[0];
  const result=results[role.id];
  if(busy)return {role:role.id,speaker:role.name,kind:'답변 확인 중',text:'제출한 답변을 세 관점으로 평가하고 있습니다. 결과가 도착할 때까지 잠시 기다려 주세요.',state:'평가 진행 중',phase:'answer'};
  if(result?.error)return {role:role.id,speaker:role.name,kind:'평가 미완료',text:result.error,state:'일부 평가 확인 필요',phase:'feedback'};
  if(result)return {role:role.id,speaker:role.name,kind:exampleMode?'기록된 피드백 · 꼬리질문':'피드백 · 꼬리질문',text:result.followup,state:'피드백 도착',phase:'feedback'};
  return {role:role.id,speaker:role.name,kind:answerLoaded?'이번 질문':'첫 질문',text:question.trim()||QUESTION,state:answerLoaded?'답변 준비됨':'질문을 듣는 중',phase:answerLoaded?'answer':'question'};
}
