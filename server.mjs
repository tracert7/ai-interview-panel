import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ROLES,validateInput,validateFeedback,buildRequest} from './docs/core.mjs';
const ROOT=path.resolve(fileURLToPath(new URL('./docs/',import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
export async function evaluateRole(role,input,{apiKey,model,fetchImpl=fetch,signal}) {
  const r=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(buildRequest(role,input,model)),signal});
  if(!r.ok) throw Error(r.status===429?'이용 한도 또는 요청 제한입니다. 자동 재시도하지 않았습니다.':r.status===401?'서버의 API 키를 확인해 주세요.':'API 요청이 실패했습니다 ('+r.status+').');
  const data=await r.json();
  if(data.status!=='completed') throw Error('응답이 완료되지 않았습니다. 자동 재시도하지 않았습니다.');
  const text=(data.output||[]).flatMap(o=>o.type==='message'?o.content||[]:[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  let parsed; try {parsed=JSON.parse(text);} catch {throw Error('완성된 평가 문장을 받지 못했습니다.');}
  const feedback=validateFeedback(parsed,input.answer);
  return {role:role.id,...feedback,usage:data.usage?{input_tokens:data.usage.input_tokens,output_tokens:data.usage.output_tokens}:null};
}
export function createApp({apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL,fetchImpl=fetch}={}) {
  let busy=false,lastStarted=0;
  return http.createServer(async(req,res)=>{
    const host=req.headers.host||'';
    const allowedHost=/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
    const origin=req.headers.origin;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    function json(status,obj){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
    if(!allowedHost || (origin && origin!=='http://'+host)) return json(403,{error:'같은 PC의 모의면접실에서만 사용할 수 있습니다.'});
    const url=new URL(req.url,'http://'+host);
    if(req.method==='GET'&&url.pathname==='/api/config') return json(200,{ready:!!apiKey&&!!model,model:model||null,mode:'local'});
    if(req.method==='POST'&&url.pathname==='/api/evaluate') {
      if(origin!=='http://'+host||req.headers['x-interview-client']!=='1'||!req.headers['content-type']?.startsWith('application/json')) return json(403,{error:'화면의 평가 버튼을 사용해 주세요.'});
      if(!apiKey||!model) return json(503,{error:'서버에 OPENAI_API_KEY와 OPENAI_MODEL을 설정한 뒤 다시 시작해 주세요.'});
      if(busy||Date.now()-lastStarted<3000) return json(429,{error:'진행 중인 평가가 끝난 뒤 다시 요청해 주세요.'});
      let input;
      try {const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>80000)throw Error('입력이 너무 깁니다.');chunks.push(b);}input=validateInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
      catch{return json(400,{error:'입력값의 길이·형식·빈칸을 확인해 주세요.'});}
      busy=true;lastStarted=Date.now();
      const control=new AbortController();
      const timer=setTimeout(()=>control.abort(),90000);
      res.on('close',()=>{if(!res.writableEnded)control.abort();});
      res.writeHead(200,{...headers,'Content-Type':'application/x-ndjson; charset=utf-8'});
      const send=v=>{if(!res.destroyed)res.write(JSON.stringify(v)+'\n');};
      send({type:'started',roles:ROLES.map(r=>r.id),model});
      try {
        await Promise.all(ROLES.map(async role=>{
          try{const result=await evaluateRole(role,input,{apiKey,model,fetchImpl,signal:control.signal});send({type:'result',result});}
          catch(e){send({type:'error',role:role.id,error:control.signal.aborted?'중단되었거나 제한 시간을 넘었습니다. 이미 사용한 API 비용은 발생할 수 있습니다.':e.message});}
        }));
        send({type:'done'});
      } finally {clearTimeout(timer);busy=false;res.end();}
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'지원하지 않는 요청입니다.'});
    let rel;try{rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';}catch{return json(400,{error:'잘못된 주소입니다.'});}
    const target=path.resolve(ROOT,rel);
    if(!target.startsWith(ROOT+path.sep) && target!==path.join(ROOT,'index.html'))return json(404,{error:'파일을 찾지 못했습니다.'});
    if(!MIME[path.extname(target)])return json(404,{error:'파일을 찾지 못했습니다.'});
    try{const data=await readFile(target);res.writeHead(200,{...headers,'Content-Type':MIME[path.extname(target)]});res.end(req.method==='HEAD'?undefined:data);}
    catch {json(404,{error:'파일을 찾지 못했습니다.'});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4317);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT는 1024~65535 정수여야 합니다.');
  createApp().listen(port,'127.0.0.1',()=>console.log('AI 모의면접실: http://127.0.0.1:'+port+' (키·답변은 로그에 기록하지 않습니다)'));
}
