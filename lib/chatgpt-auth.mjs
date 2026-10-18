import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {SecureStore} from './secure-store.mjs';

export const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
export const AUTH_SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random=()=>randomBytes(32).toString('base64url');
export function sameSecret(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export async function verifyIdToken(token,{clientId,nonce,expectedSubject,jwks}){
  const {payload}=await jwtVerify(token,jwks,{issuer:ISSUER,audience:clientId,algorithms:['RS256','ES256','PS256'],clockTolerance:5});
  if(!payload.sub||typeof payload.sub!=='string'||(nonce&&!sameSecret(payload.nonce,nonce))||(expectedSubject&&payload.sub!==expectedSubject))throw Error('ChatGPT 로그인 계정 검증에 실패했습니다.');
  return {subject:payload.sub,email:typeof payload.email==='string'?payload.email:null};
}
function maskEmail(email){if(!email)return null;const [name,domain]=email.split('@');return domain?name.slice(0,1)+'***@'+domain:null;}
function tokensFrom(data,previous=null){
  if(!data||typeof data.id_token!=='string'&&!previous||data.access_token!==undefined&&typeof data.access_token!=='string')throw Error('로그인 응답 형식이 올바르지 않습니다.');
  const scopes=typeof data.scope==='string'?data.scope.split(/\s+/).filter(Boolean):previous?.scopes;
  if(!scopes)throw Error('허용된 로그인 권한을 확인하지 못했습니다.');
  const access=data.access_token||null,expires=Number(data.expires_in||0);
  if(access&&(!(expires>0)||!Number.isFinite(expires)||expires>31_536_000||String(data.token_type).toLowerCase()!=='bearer'))throw Error('로그인 토큰 유효기간 또는 유형이 올바르지 않습니다.');
  return {accessToken:access,refreshToken:data.refresh_token||previous?.refreshToken||null,idToken:data.id_token||previous?.idToken,scopes,expiresAt:Date.now()+expires*1000};
}
export class ChatGPTAuth{
  constructor({directory,fetchImpl=fetch,store,verify=verifyIdToken}={}){this.fetch=fetchImpl;this.store=store||new SecureStore(directory);this.verify=verify;this.pending=null;this.refreshing=null;this.cachedModels=null;this.error=null;this.ready=this.init();}
  async init(){try{this.data=await this.store.init();}catch{this.error='로그인 저장소를 열지 못했습니다. 기존 .private 폴더를 보존한 채 권한과 PC 계정을 확인해 주세요.';this.data=null;}}
  async assertReady(){await this.ready;if(this.error)throw Error(this.error);}
  async discovery(){
    if(this.discoveryData)return this.discoveryData;
    const r=await this.fetch(ISSUER+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('공식 로그인 설정을 불러오지 못했습니다.');const d=await r.json();
    if(d.issuer!==ISSUER)throw Error('로그인 발급자가 올바르지 않습니다.');
    for(const k of ['authorization_endpoint','token_endpoint','jwks_uri','revocation_endpoint']){if(k==='revocation_endpoint'&&!d[k])continue;if(typeof d[k]!=='string'||new URL(d[k]).origin!==ISSUER)throw Error('공식 로그인 주소를 확인하지 못했습니다.');}
    this.discoveryData=d;this.jwks=createRemoteJWKSet(new URL(d.jwks_uri),{timeoutDuration:15000});return d;
  }
  publicStatus(){
    const active=this.data?.profiles.find(p=>p.clientId===this.data.activeId);return {connected:!!active?.credentials,sharing:!!active?.credentials?.accessToken&&active.credentials.scopes.includes('chatgpt.tokens.use.direct')&&active.credentials.scopes.includes('resource.invoke'),activeId:active?.clientId||null,defaultAccountId:active?.clientId||this.data?.profiles.filter(p=>!p.subject).at(-1)?.clientId||null,recoveryPending:!!active?.pendingRefresh,signInPending:!!this.pending&&this.pending.expires>Date.now(),accounts:(this.data?.profiles||[]).map((p,i)=>({id:p.clientId,label:p.email?maskEmail(p.email):'ChatGPT 계정 '+(i+1),connected:!!p.credentials})),storage:this.store.memoryOnly?'memory':'windows-dpapi',error:this.error};
  }
  async begin({baseUrl,accountId=null}={}){
    await this.assertReady();if(this.starting||this.pending&&this.pending.expires>Date.now())throw Error('로그인이 진행 중입니다. 열린 로그인 화면을 완료하거나 취소해 주세요.');
    this.starting=true;try{
    if(new URL(baseUrl).hostname!=='127.0.0.1'||new URL(baseUrl).protocol!=='http:')throw Error('로그인은 127.0.0.1의 로컬 앱에서 시작해 주세요.');
    const profile=accountId?this.data.profiles.find(p=>p.clientId===accountId):null;if(accountId&&!profile)throw Error('등록된 계정을 선택해 주세요.');
    const d=await this.discovery();const state=random(),nonce=random(),verifier=random();const redirectUri=baseUrl+'/auth/callback';
    this.pending={state,nonce,verifier,redirectUri,clientId:profile?.clientId||null,expectedSubject:profile?.subject||null,expires:Date.now()+300000};
    const url=new URL(d.authorization_endpoint);for(const [k,v] of Object.entries({client_id:profile?.clientId||'dynamic_agent_client',ext_agent_host_id:this.store.hostId,response_type:'code',redirect_uri:redirectUri,scope:AUTH_SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}))url.searchParams.set(k,v);
    if(!profile)url.searchParams.set('agent_name_hint','AI 모의면접실');
    return url.toString();
    }finally{this.starting=false;}
  }
  cancel(){this.pending=null;}
  async tokenRequest(form){
    const d=await this.discovery();const r=await this.fetch(d.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form),signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!r.ok)throw Error('로그인 승인이 완료되지 않았거나 만료됐습니다. 다시 로그인해 주세요.');return r.json();
  }
  async callback(params){
    await this.assertReady();const pending=this.pending;if(!pending||pending.expires<Date.now()||!sameSecret(params.get('state'),pending.state))throw Error('로그인 상태 검증에 실패했습니다. 앱에서 다시 시작해 주세요.');
    this.pending=null;if(params.get('error'))throw Error('로그인 또는 구독 사용 승인이 취소됐습니다.');
    const supplied=params.get('client_id');const clientId=pending.clientId||supplied;
    if(!clientId||clientId==='dynamic_agent_client'||!/^[A-Za-z0-9_-]{6,256}$/.test(clientId)||(pending.clientId&&supplied&&supplied!==pending.clientId))throw Error('앱 등록 식별자를 확인하지 못했습니다.');
    const code=params.get('code');if(!code||code.length>10000)throw Error('로그인 승인 코드가 없습니다.');
    let profile=this.data.profiles.find(p=>p.clientId===clientId);
    if(!profile){profile={clientId,subject:null,email:null,credentials:null};this.data.profiles.push(profile);await this.store.save(this.data);}
    const response=await this.tokenRequest({grant_type:'authorization_code',client_id:clientId,code,code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource:RESOURCE});
    const credentials=tokensFrom(response);await this.discovery();const identity=await this.verify(credentials.idToken,{clientId,nonce:pending.nonce,expectedSubject:pending.expectedSubject||profile.subject,jwks:this.jwks});
    Object.assign(profile,{...identity,credentials,pendingRefresh:null});this.data.activeId=clientId;this.cachedModels=null;await this.store.save(this.data);return this.publicStatus();
  }
  async credentials(){
    await this.assertReady();if(this.refreshing)return this.refreshing;
    this.refreshing=this.ensureCredentials();try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  async ensureCredentials(){
    const p=this.data.profiles.find(x=>x.clientId===this.data.activeId);if(!p?.credentials)throw Error('먼저 Continue with ChatGPT로 로그인해 주세요.');
    if(p.pendingRefresh){if(p.pendingRefresh.verifyIdentity){await this.discovery();await this.verify(p.pendingRefresh.idToken,{clientId:p.clientId,expectedSubject:p.subject,jwks:this.jwks});}p.credentials=p.pendingRefresh;p.pendingRefresh=null;await this.store.save(this.data);}
    let c=p.credentials;if(!c.scopes.includes('chatgpt.tokens.use.direct')||!c.scopes.includes('resource.invoke'))throw Error('로그인은 됐지만 구독 사용 권한이 없습니다. ChatGPT에서 앱 권한을 확인한 뒤 다시 로그인해 주세요.');
    if(c.expiresAt>Date.now()+10000)return c;
    if(!c.refreshToken)throw Error('로그인이 만료됐습니다. 다시 연결해 주세요.');
    const response=await this.tokenRequest({grant_type:'refresh_token',client_id:p.clientId,refresh_token:c.refreshToken,resource:RESOURCE});
    const rotated=tokensFrom(response,c);
    // Persist a rotated refresh token before any signing-key lookup; never reuse its consumed predecessor.
    p.pendingRefresh={...rotated,verifyIdentity:!!response.id_token};p.credentials={...c,accessToken:null,refreshToken:null};await this.store.save(this.data);
    if(response.id_token){await this.discovery();await this.verify(rotated.idToken,{clientId:p.clientId,expectedSubject:p.subject,jwks:this.jwks});}
    p.credentials=rotated;p.pendingRefresh=null;await this.store.save(this.data);return rotated;
  }
  async models(){
    const c=await this.credentials();const r=await this.fetch(RESOURCE+'/models',{headers:{Authorization:'Bearer '+c.accessToken},signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!r.ok)throw Error('구독 모델 목록을 불러오지 못했습니다. 계정 권한과 구독 한도를 확인해 주세요.');const d=await r.json();if(!Array.isArray(d.models))throw Error('구독용 모델 목록 형식이 올바르지 않습니다.');
    this.cachedModels=d.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&typeof m.display_name==='string').map(m=>({id:m.slug,name:m.display_name}));return this.cachedModels;
  }
  async select(accountId){await this.assertReady();if(!this.data.profiles.some(p=>p.clientId===accountId))throw Error('등록된 계정이 아닙니다.');this.pending=null;this.data.activeId=accountId;this.cachedModels=null;await this.store.save(this.data);return this.publicStatus();}
  async logout(){
    await this.assertReady();this.pending=null;const p=this.data.profiles.find(x=>x.clientId===this.data.activeId);if(!p)return {revoked:true};let revoked=true;
    const refreshToken=p.pendingRefresh?.refreshToken||p.credentials?.refreshToken;
    if(refreshToken){try{const d=await this.discovery();if(!d.revocation_endpoint)revoked=false;else{const r=await this.fetch(d.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refreshToken,token_type_hint:'refresh_token',client_id:p.clientId}),signal:AbortSignal.timeout(15000),redirect:'error'});revoked=r.status===200;}}catch{revoked=false;}}
    p.credentials=null;p.pendingRefresh=null;this.cachedModels=null;await this.store.save(this.data);return {revoked};
  }
  close(){this.store.release?.();}
}
