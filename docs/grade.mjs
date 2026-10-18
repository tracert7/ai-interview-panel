import {ROLES,CRITERIA} from './core.mjs';
export const GRADE_SCHEME='answer-rank-v1';
export const GRADE_TIERS=Object.freeze([
  {label:'S',min:95,color:'#f5d078',surface:'#302614',title:'아주 탄탄하게 완성한 답변'},
  {label:'A+',min:90,color:'#e2c8ff',surface:'#2c1d3e',title:'명료하게 전달한 답변'},
  {label:'A',min:85,color:'#c6ceff',surface:'#232c4d',title:'좋은 근거를 갖춘 답변'},
  {label:'B+',min:80,color:'#a6d0ff',surface:'#19314b',title:'핵심이 잘 드러난 답변'},
  {label:'B',min:75,color:'#9ce6ee',surface:'#16343a',title:'조금 더 구체화하면 좋아요'},
  {label:'C+',min:70,color:'#a6e6d2',surface:'#19382e',title:'근거와 연결을 더해보세요'},
  {label:'C',min:65,color:'#d1e6b0',surface:'#2d391f',title:'설명의 빈칸을 채워보세요'},
  {label:'D',min:60,color:'#d2ddeb',surface:'#2e394b',title:'질문에 맞춰 다시 정리해요'},
  {label:'E',min:50,color:'#ffd5aa',surface:'#49301d',title:'본인의 행동부터 설명해요'},
  {label:'F',min:0,color:'#ffbcc8',surface:'#4b2431',title:'한 가지 경험부터 시작해요'}
].map(t=>Object.freeze(t)));
export function overallGrade(results={}){
  const valid=ROLES.map(role=>results?.[role.id]).filter(r=>r&&!r.error&&Array.isArray(r.scores)&&r.scores.length===5&&r.scores.every(n=>Number.isInteger(n)&&n>=0&&n<=4)&&r.total===r.scores.reduce((a,b)=>a+b,0));
  if(valid.length!==ROLES.length)return {status:'incomplete',completed:valid.length,required:ROLES.length,scheme:GRADE_SCHEME};
  const total=valid.reduce((n,r)=>n+r.total,0),maximum=60;
  // Compare integer products: rounding the display must never promote a grade.
  const tier=GRADE_TIERS.find(t=>total*100>=t.min*maximum);
  return {status:'complete',completed:3,required:3,scheme:GRADE_SCHEME,total,maximum,percentage:Math.round(total/maximum*1000)/10,tier,
    criteria:CRITERIA.map((name,i)=>({name,total:valid.reduce((n,r)=>n+r.scores[i],0),maximum:12}))};
}
