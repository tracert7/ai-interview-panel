import test from 'node:test';
import assert from 'node:assert/strict';
import {actorStates} from '../docs/game-state.mjs';
test('game: selected interviewer speaks, all listen to the applicant',()=>{
 assert.equal(actorStates({speaker:'lead'}).lead.pose,'speaking');
 assert.equal(actorStates({speaker:'lead'}).hr.pose,'idle');
 for(const s of Object.values(actorStates({listening:true})))assert.equal(s.pose,'listening');
});
test('game: each real result independently ends thinking, failure is not completion',()=>{
 const states=actorStates({evaluating:true,results:{hr:{total:12},lead:{error:'failed'}}});
 assert.equal(states.hr.pose,'ready');assert.equal(states.lead.pose,'error');assert.equal(states.practitioner.pose,'thinking');
 assert.equal(actorStates({results:{hr:{error:'cancelled'}}}).lead.pose,'idle');
});
