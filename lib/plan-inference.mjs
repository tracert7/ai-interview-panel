import {buildRequest,validateFeedback} from '../docs/core.mjs';
export function buildPlanRequest(role,input,model){
  const request=buildRequest(role,input,model);delete request.max_output_tokens;
  return {...request,store:false,stream:true};
}
export async function* streamEvents(body){
  const decoder=new TextDecoder();let buffer='',total=0;
  for await(const chunk of body){total+=chunk.length;if(total>2_000_000)throw Error('응답이 너무 길어 평가를 중단했습니다.');buffer+=decoder.decode(chunk,{stream:true});
    let match;while((match=/\r?\n\r?\n/.exec(buffer))){const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const payload=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(payload&&payload!=='[DONE]')yield JSON.parse(payload);}
  }
  // A successful evaluation requires the terminal response.completed event, not a closed connection.
  if(buffer.trim())throw Error('응답 스트림이 완료 전에 끝났습니다. 자동 재요청하지 않았습니다.');
}
export async function evaluateRole(role,input,{accessToken,model,fetchImpl=fetch,signal}){
  if(!accessToken)throw Error('ChatGPT 구독 로그인 연결이 필요합니다.');
  const r=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(buildPlanRequest(role,input,model)),signal,redirect:'error'});
  if(!r.ok)throw Error(r.status===401?'로그인이 만료됐거나 권한이 없습니다. 다시 연결해 주세요.':r.status===429?'구독 사용 한도 또는 요청 제한입니다. 별도 API 결제나 자동 재시도로 전환하지 않았습니다.':'구독 평가 요청이 실패했습니다 ('+r.status+').');
  let completed=null,text='';
  for await(const event of streamEvents(r.body)){
    if(event.type==='response.output_text.delta')text+=event.delta||'';
    if(event.type==='response.failed'||event.type==='error')throw Error('구독 요청이 거절됐습니다. ChatGPT의 앱 사용 한도·연결 권한을 확인해 주세요. 별도 결제로 전환하지 않았습니다.');
    if(event.type==='response.incomplete')throw Error('평가가 끝나지 않았습니다. 자동 재요청하지 않았습니다.');
    if(event.type==='response.completed')completed=event.response;
  }
  if(!completed||completed.status!=='completed')throw Error('완료된 평가를 받지 못했습니다. 자동 재요청하지 않았습니다.');
  const final=(completed.output||[]).flatMap(o=>o.type==='message'?o.content||[]:[]).filter(c=>c.type==='output_text').map(c=>c.text).join('')||text;
  let parsed;try{parsed=JSON.parse(final);}catch{throw Error('평가 결과 형식이 맞지 않습니다. 자동 재요청하지 않았습니다.');}
  return {role:role.id,...validateFeedback(parsed,input.answer),usage:completed.usage?{input_tokens:completed.usage.input_tokens,output_tokens:completed.usage.output_tokens}:null};
}
