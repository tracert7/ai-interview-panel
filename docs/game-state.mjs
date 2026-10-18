// Animation follows transport state, never simulated reasoning or score estimates.
export function actorStates({speaker='hr',results={},evaluating=false,listening=false,answerLoaded=false}={}) {
  return Object.fromEntries(['hr','lead','practitioner'].map(id=>{
    const result=results[id];
    const pose=result?.error?'error':result?'ready':evaluating?'thinking':listening||answerLoaded?'listening':id===speaker?'speaking':'idle';
    const label=pose==='thinking'?'답변 검토 중':pose==='ready'?'평가 도착':pose==='error'?'확인 필요':pose==='speaking'?'질문 중':listening?'듣는 중':'대기 중';
    return [id,{pose,label}];
  }));
}
