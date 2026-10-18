import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {ChatGPTAuth,verifyIdToken,ISSUER} from '../lib/chatgpt-auth.mjs';
const config={issuer:ISSUER,authorization_endpoint:ISSUER+'/api/accounts/authorize',token_endpoint:ISSUER+'/api/accounts/oauth/token',jwks_uri:ISSUER+'/keys',revocation_endpoint:ISSUER+'/revoke'};
class MemoryStore{constructor(data){this.hostId='urn:uuid:91aaac24-f2eb-4c2a-bb88-131dcb1f002b';this.memoryOnly=true;this.data=data||{version:1,activeId:null,profiles:[]};this.writes=[];}async init(){return structuredClone(this.data);}async save(d){this.data=structuredClone(d);this.writes.push(structuredClone(d));}}
const token=(scope='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct')=>({id_token:'SYNTHETIC_ID_TOKEN',access_token:'SYNTHETIC_ACCESS',refresh_token:'SYNTHETIC_REFRESH',token_type:'Bearer',expires_in:3600,scope});
function client({scope,verify=async()=>({subject:'fictional-subject',email:'fictional@example.invalid'}),extraFetch}={}){
 const calls=[],store=new MemoryStore();const auth=new ChatGPTAuth({store,verify,fetchImpl:async(url,opts)=>{calls.push({url,opts});if(url.endsWith('openid-configuration'))return {ok:true,json:async()=>config};if(url===config.token_endpoint)return {ok:true,json:async()=>token(scope)};if(extraFetch)return extraFetch(url,opts);throw Error('unexpected request');}});return {auth,store,calls};
}
test('OAuth first registration uses PKCE, random state/nonce, local callback and no API secret',async()=>{
 const {auth}=client();const url=new URL(await auth.begin({baseUrl:'http://127.0.0.1:4317'}));
 assert.equal(url.origin,ISSUER);assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:4317/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));assert(!url.searchParams.has('client_secret'));assert(url.searchParams.get('state').length>=40);assert(url.searchParams.get('nonce').length>=40);
 await assert.rejects(auth.begin({baseUrl:'http://127.0.0.1:4317'}),/진행 중/);
});
test('bad state and changed issued client ID cannot exchange a code',async()=>{
 const {auth,calls}=client();const url=new URL(await auth.begin({baseUrl:'http://127.0.0.1:4317'}));
 await assert.rejects(auth.callback(new URLSearchParams({state:'wrong',code:'synthetic',client_id:'oaiapp_test'})),/상태 검증/);
 assert(!calls.some(c=>c.url===config.token_endpoint));
 await auth.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_test'}));
 const next=new URL(await auth.begin({baseUrl:'http://127.0.0.1:4317',accountId:'oaiapp_test'}));assert.equal(next.searchParams.get('client_id'),'oaiapp_test');assert(!next.searchParams.has('agent_name_hint'));
 await assert.rejects(auth.callback(new URLSearchParams({state:next.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_other'})),/식별자/);
});
test('verified account and sharing permission are separate; public status never exposes tokens',async()=>{
 const {auth}=client();const url=new URL(await auth.begin({baseUrl:'http://127.0.0.1:4317'}));await auth.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_test'}));
 const status=auth.publicStatus();assert.equal(status.connected,true);assert.equal(status.sharing,true);assert(!JSON.stringify(status).includes('SYNTHETIC'));assert(!JSON.stringify(status).includes('fictional@example.invalid'));
 const other=client({scope:'openid profile email'});const u=new URL(await other.auth.begin({baseUrl:'http://127.0.0.1:4317'}));await other.auth.callback(new URLSearchParams({state:u.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_identity'}));assert.equal(other.auth.publicStatus().connected,true);assert.equal(other.auth.publicStatus().sharing,false);await assert.rejects(other.auth.credentials(),/구독 사용 권한/);
});
test('OIDC signature, issuer, audience, expiry, nonce and account identity are checked',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const sign=async({iss=ISSUER,aud='oaiapp_test',nonce='expected',expired=false}={})=>new SignJWT({nonce,email:'fake@example.invalid'}).setProtectedHeader({alg:'RS256'}).setSubject('synthetic-subject').setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(expired?'1s':'5m').sign(privateKey);
 const valid=await sign();assert.equal((await verifyIdToken(valid,{clientId:'oaiapp_test',nonce:'expected',jwks:publicKey})).subject,'synthetic-subject');
 for(const params of [{iss:'https://other.invalid'},{aud:'other'},{nonce:'wrong'}])await assert.rejects(verifyIdToken(await sign(params),{clientId:'oaiapp_test',nonce:'expected',jwks:publicKey}));
 await assert.rejects(verifyIdToken(valid,{clientId:'oaiapp_test',nonce:'expected',expectedSubject:'other-subject',jwks:publicKey}));
 const expired=await new SignJWT({nonce:'expected'}).setProtectedHeader({alg:'RS256'}).setSubject('synthetic-subject').setIssuer(ISSUER).setAudience('oaiapp_test').setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);await assert.rejects(verifyIdToken(expired,{clientId:'oaiapp_test',nonce:'expected',jwks:publicKey}));
});
test('discovery endpoints cannot redirect credentials to another host',async()=>{
 const auth=new ChatGPTAuth({store:new MemoryStore(),fetchImpl:async()=>({ok:true,json:async()=>({...config,token_endpoint:'https://other.invalid/token'})})});await assert.rejects(auth.begin({baseUrl:'http://127.0.0.1:4317'}),/공식 로그인 주소/);
});
test('refresh is serialized and rotated token is saved before identity verification',async()=>{
 const record={version:1,activeId:'oaiapp_test',profiles:[{clientId:'oaiapp_test',subject:'fictional-subject',email:null,credentials:{accessToken:'old-access',refreshToken:'old-refresh',idToken:'old-id',expiresAt:0,scopes:['resource.invoke','chatgpt.tokens.use.direct']}}]};
 const store=new MemoryStore(record);let refreshCalls=0,verificationFailed=false;
 const auth=new ChatGPTAuth({store,verify:async()=>{if(!verificationFailed){verificationFailed=true;throw Error('mock signing-key outage');}return {subject:'fictional-subject'};},fetchImpl:async(url,opts)=>{if(url.endsWith('openid-configuration'))return {ok:true,json:async()=>config};if(url===config.token_endpoint){refreshCalls++;assert.equal(new URLSearchParams(opts.body).get('refresh_token'),'old-refresh');return {ok:true,json:async()=>token()};}throw Error('unexpected');}});
 await assert.rejects(auth.credentials(),/mock signing-key outage/);assert.equal(store.data.profiles[0].pendingRefresh.refreshToken,'SYNTHETIC_REFRESH');assert.equal(store.data.profiles[0].credentials.refreshToken,null);
 const results=await Promise.all([auth.credentials(),auth.credentials(),auth.credentials()]);assert(results.every(c=>c.accessToken==='SYNTHETIC_ACCESS'));assert.equal(refreshCalls,1);assert.equal(store.data.profiles[0].pendingRefresh,null);
});
test('remote revocation failure still clears local tokens and is reported honestly',async()=>{
 const {auth}=client({extraFetch:async()=>({ok:false,status:503})});const url=new URL(await auth.begin({baseUrl:'http://127.0.0.1:4317'}));await auth.callback(new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_test'}));const result=await auth.logout();assert.equal(result.revoked,false);assert.equal(auth.publicStatus().connected,false);assert.equal(auth.data.profiles[0].clientId,'oaiapp_test');
});
