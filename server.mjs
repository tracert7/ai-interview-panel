import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROLES,validateInput} from './docs/core.mjs';
import {ChatGPTAuth} from './lib/chatgpt-auth.mjs';
import {evaluateRole} from './lib/plan-inference.mjs';
export {evaluateRole} from './lib/plan-inference.mjs';
const ROOT=path.resolve(fileURLToPath(new URL('./docs/',import.meta.url)));
const PRIVATE=fileURLToPath(new URL('./.private/',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
export function createApp({auth,fetchImpl=fetch}={}){
  auth ||= new ChatGPTAuth({directory:PRIVATE,fetchImpl});
  let busy=false,lastStarted=0,authNotice=null,pendingDraft=null;
  const server=http.createServer(async(req,res)=>{
    const host=req.headers.host||'',origin=req.headers.origin;
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    function json(status,obj){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)||(origin&&origin!=='http://'+host))return json(403,{error:'같은 PC의 면접실에서만 사용할 수 있습니다.'});
    const base='http://'+host,url=new URL(req.url,base);
    const protectedPost=()=>origin===base&&req.headers['x-interview-client']==='1'&&req.headers['content-type']?.startsWith('application/json');
    async function body(){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>80000)throw Error('입력이 너무 깁니다.');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    try{
      await auth.ready;
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const state=auth.publicStatus();return json(200,{...state,ready:state.connected&&state.sharing,mode:'chatgpt-plan',apiKeyFallback:false,notice:authNotice});
      }
      if(req.method==='GET'&&url.pathname==='/api/models')return json(200,{models:await auth.models()});
      if(req.method==='GET'&&url.pathname==='/api/draft'){
        if(req.headers['x-interview-client']!=='1')return json(403,{error:'면접실에서만 임시 입력을 이어갈 수 있습니다.'});
        const draft=pendingDraft&&pendingDraft.expires>Date.now()?pendingDraft.value:null;pendingDraft=null;return json(200,{draft});
      }
      if(req.method==='GET'&&url.pathname==='/auth/callback'){
        try{await auth.callback(url.searchParams);authNotice='ChatGPT 로그인 연결을 확인했습니다. 모델과 입력 전송 동의를 확인한 뒤 평가를 시작하세요.';}
        catch{authNotice='로그인이 완료되지 않았습니다. 승인이 취소되었거나 계정 검증에 실패했습니다. 앱에서 다시 연결해 주세요.';}
        res.writeHead(303,{...headers,Location:'/'});res.end();return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/auth/')){
        if(!protectedPost())return json(403,{error:'면접실 화면의 연결 버튼을 사용해 주세요.'});
        if(busy)return json(409,{error:'진행 중인 평가를 끝내거나 중단한 뒤 계정을 변경해 주세요.'});
        const input=await body();
        if(url.pathname==='/api/auth/start'){
          const draft={};for(const [key,max] of [['job',6000],['facts',8000],['question',1000],['answer',5000]])if(typeof input.draft?.[key]==='string')draft[key]=input.draft[key].slice(0,max);
          const target=await auth.begin({baseUrl:base,accountId:input.accountId||null});pendingDraft={value:draft,expires:Date.now()+300000};return json(200,{url:target});
        }
        if(url.pathname==='/api/auth/select')return json(200,await auth.select(input.accountId));
        if(url.pathname==='/api/auth/cancel'){auth.cancel();pendingDraft=null;return json(200,{cancelled:true});}
        if(url.pathname==='/api/auth/logout'){const state=await auth.logout();pendingDraft=null;authNotice=state.revoked?'이 PC의 로그인 토큰을 지우고 연결을 종료했습니다.':'이 PC의 로그인은 종료했습니다. 원격 권한 취소는 확인되지 않아 ChatGPT 설정에서 앱 연결도 확인해 주세요.';return json(200,{...state,notice:authNotice});}
        return json(404,{error:'지원하지 않는 연결 요청입니다.'});
      }
      if(req.method==='POST'&&url.pathname==='/api/evaluate'){
        if(!protectedPost())return json(403,{error:'화면의 답변 제출 버튼을 사용해 주세요.'});
        if(busy||Date.now()-lastStarted<3000)return json(429,{error:'진행 중인 평가가 끝난 뒤 다시 요청해 주세요.'});
        let input,model;
        try{const data=await body();input=validateInput(data);model=data.model;if(typeof model!=='string'||model.length>150)throw Error();}
        catch{return json(400,{error:'공고·경험·질문·답변과 선택한 모델을 확인해 주세요.'});}
        if(!auth.publicStatus().sharing)return json(401,{error:'먼저 Continue with ChatGPT로 로그인하고 구독 사용을 허용해 주세요.'});
        if(!auth.cachedModels?.some(m=>m.id===model))return json(400,{error:'이 계정의 모델 목록에서 사용할 모델을 선택해 주세요.'});
        busy=true;lastStarted=Date.now();
        let credentials;
        try{credentials=await auth.credentials();}catch{busy=false;return json(401,{error:'로그인 권한을 확인하지 못했습니다. 다시 연결해 주세요.'});}
        const control=new AbortController(),timer=setTimeout(()=>control.abort(),90000);
        res.on('close',()=>{if(!res.writableEnded)control.abort();});
        res.writeHead(200,{...headers,'Content-Type':'application/x-ndjson; charset=utf-8'});
        const send=v=>{if(!res.destroyed)res.write(JSON.stringify(v)+'\n');};
        send({type:'started',roles:ROLES.map(r=>r.id),model,provider:'chatgpt-plan'});
        try{
          await Promise.all(ROLES.map(async role=>{
            try{send({type:'result',result:await evaluateRole(role,input,{accessToken:credentials.accessToken,model,fetchImpl,signal:control.signal})});}
            catch(e){send({type:'error',role:role.id,error:control.signal.aborted?'평가가 중단되었거나 제한 시간을 넘었습니다. 이미 사용한 구독 사용량은 되돌릴 수 없습니다.':e.message});}
          }));send({type:'done'});
        }finally{clearTimeout(timer);busy=false;res.end();}
        return;
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'지원하지 않는 요청입니다.'});
      let rel;try{rel=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';}catch{return json(400,{error:'잘못된 주소입니다.'});}
      const target=path.resolve(ROOT,rel);
      if(!target.startsWith(ROOT+path.sep)&&target!==path.join(ROOT,'index.html'))return json(404,{error:'파일을 찾지 못했습니다.'});
      if(!MIME[path.extname(target)])return json(404,{error:'파일을 찾지 못했습니다.'});
      try{const data=await readFile(target);res.writeHead(200,{...headers,'Content-Type':MIME[path.extname(target)]});res.end(req.method==='HEAD'?undefined:data);}catch{json(404,{error:'파일을 찾지 못했습니다.'});}
    }catch(e){if(!res.headersSent)json(400,{error:e.message||'요청을 처리하지 못했습니다.'});else res.end();}
  });server.on('close',()=>auth.close?.());return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4317);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT는 1024~65535 정수여야 합니다.');
  const app=createApp();
  app.on('error',()=>console.error('면접실을 시작하지 못했습니다. 같은 포트를 사용하는 창을 닫고 다시 실행해 주세요.'));
  app.listen(port,'127.0.0.1',()=>{
    const url='http://127.0.0.1:'+port+'/';console.log('AI 모의면접실: '+url+' · ChatGPT 구독 로그인 전용 · API 키 자동 전환 없음');
    if(process.argv.includes('--open')){
      if(process.platform==='win32')spawn('cmd.exe',['/d','/s','/c','start "" "'+url+'"'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
      else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'}).on('error',()=>{});
    }
  });
}
