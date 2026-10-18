import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES} from '../docs/core.mjs';
import {GRADE_TIERS,GRADE_SCHEME,overallGrade} from '../docs/grade.mjs';
export function scoresForTotal(total){return Object.fromEntries(ROLES.map(role=>{const scores=Array.from({length:5},()=>{const n=Math.min(4,total);total-=n;return n;});return [role.id,{scores,total:scores.reduce((a,b)=>a+b,0)}];}));}
test('all ten requested grades, exact thresholds and top/bottom limits',()=>{
 assert.deepEqual(GRADE_TIERS.map(t=>t.label),['S','A+','A','B+','B','C+','C','D','E','F']);
 for(const [total,tier]of[[60,'S'],[57,'S'],[56,'A+'],[54,'A+'],[53,'A'],[51,'A'],[50,'B+'],[48,'B+'],[47,'B'],[45,'B'],[44,'C+'],[42,'C+'],[41,'C'],[39,'C'],[38,'D'],[36,'D'],[35,'E'],[30,'E'],[29,'F'],[0,'F']]){
  const result=overallGrade(scoresForTotal(total));assert.equal(result.tier.label,tier);assert.equal(result.total,total);assert.equal(result.maximum,60);assert.equal(result.scheme,GRADE_SCHEME);
 }
 assert.equal(overallGrade(scoresForTotal(56)).percentage,93.3);
});
test('every possible total is monotonic and all five criteria reconcile to the overall score',()=>{
 let last=10;for(let total=0;total<=60;total++){const g=overallGrade(scoresForTotal(total)),index=GRADE_TIERS.findIndex(t=>t.label===g.tier.label);assert(index<=last);last=index;assert.equal(g.criteria.length,5);assert.equal(g.criteria.reduce((a,c)=>a+c.total,0),total);assert(g.criteria.every(c=>c.total>=0&&c.total<=12));}
});
test('missing, failed, malformed or inconsistent role scores never produce a final letter',()=>{
 const valid=scoresForTotal(60);for(const bad of [{},{hr:valid.hr},{...valid,lead:{error:'network'}},{...valid,lead:{scores:[4,4,4,4,4],total:19}},{...valid,lead:{scores:[5,4,4,4,4],total:21}},{...valid,lead:{scores:[2.5,4,4,4,4],total:18.5}},{...valid,lead:{scores:[4,4],total:8}}]){const g=overallGrade(bad);assert.equal(g.status,'incomplete');assert(!('tier' in g));}
});
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
test('each grade letter has at least 4.5:1 contrast against its badge surface',()=>{
 for(const t of GRADE_TIERS){const a=luminance(t.color),b=luminance(t.surface);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,t.label);}
});
