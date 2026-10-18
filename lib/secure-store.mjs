import {mkdir,readFile,writeFile,rename,lstat,chmod,unlink} from 'node:fs/promises';
import {readFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

// No browser automation or credentials from other apps. DPAPI receives this app's own data over stdin.
export function windowsProtect(bytes,decrypt=false){
  const method=decrypt?'Unprotect':'Protect';
  const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
    const timer=setTimeout(()=>child.kill(),15000);
    child.stdout.on('data',b=>{out+=b.toString();if(out.length>2_000_000)child.kill();});
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(Error('Windows 자격증명 보호 기능을 사용할 수 없습니다.'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||!out.trim())return reject(Error('로그인 정보를 안전하게 처리하지 못했습니다. 기존 파일은 유지했습니다.'));resolve(Buffer.from(out.trim(),'base64'));});
    child.stdin.on('error',()=>{});child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}
export class SecureStore{
  constructor(directory,{platform=process.platform,protect=windowsProtect}={}){this.dir=path.resolve(directory);this.platform=platform;this.protect=protect;this.data=null;this.memoryOnly=platform!=='win32';}
  async init(){
    await mkdir(this.dir,{recursive:true,mode:0o700});const info=await lstat(this.dir);if(info.isSymbolicLink()||!info.isDirectory())throw Error('로그인 저장 위치가 안전한 폴더가 아닙니다.');
    if(this.platform!=='win32')await chmod(this.dir,0o700);
    const lock=path.join(this.dir,'runtime-lock.json');
    try{if((await lstat(lock)).isSymbolicLink())throw Error('unsafe');const prior=JSON.parse(await readFile(lock,'utf8'));if(prior.version!==1||!Number.isInteger(prior.pid)||prior.pid<1||typeof prior.instance!=='string')throw Error('invalid');try{process.kill(prior.pid,0);throw Error('active');}catch(e){if(e.code!=='ESRCH')throw Error('active');}await unlink(lock);}catch(e){if(e.code!=='ENOENT')throw Error('다른 면접실 창이 로그인 정보를 사용 중이거나 잠금 파일을 확인할 수 없습니다. 기존 파일을 보존하고 다른 실행 창을 닫아 주세요.');}
    this.lockId=randomUUID();await writeFile(lock,JSON.stringify({version:1,pid:process.pid,instance:this.lockId}),{flag:'wx',mode:0o600});this.exitHandler=()=>this.release();process.once('exit',this.exitHandler);
    const hostFile=path.join(this.dir,'host.json');let host;
    try{if((await lstat(hostFile)).isSymbolicLink())throw Error('unsafe');host=JSON.parse(await readFile(hostFile,'utf8')).id;}catch(e){if(e.code!=='ENOENT')throw Error('호스트 식별 파일을 읽지 못했습니다. 기존 파일을 확인해 주세요.');host='urn:uuid:'+randomUUID();await writeFile(hostFile,JSON.stringify({id:host}),{flag:'wx',mode:0o600});}
    if(!/^urn:uuid:[a-f0-9-]{36}$/.test(host))throw Error('호스트 식별 파일 형식이 올바르지 않습니다.');
    this.hostId=host;
    if(this.memoryOnly){try{this.data=JSON.parse(await readFile(path.join(this.dir,'registrations.json'),'utf8'));if(this.data.version!==1||!Array.isArray(this.data.profiles))throw Error('invalid');for(const p of this.data.profiles){p.credentials=null;p.pendingRefresh=null;}}catch(e){if(e.code==='ENOENT')this.data={version:1,activeId:null,profiles:[]};else throw Error('저장된 계정 등록 정보를 확인하지 못했습니다.');}return this.data;}
    try{const file=path.join(this.dir,'accounts.auth.enc');if((await lstat(file)).isSymbolicLink())throw Error('unsafe');const plain=await this.protect(await readFile(file),true);this.data=JSON.parse(plain.toString('utf8'));}
    catch(e){if(e.code==='ENOENT')this.data={version:1,activeId:null,profiles:[]};else throw Error('저장된 로그인 정보를 복호화하지 못했습니다. 다른 PC의 파일을 복사하지 말고 기존 파일을 보존해 주세요.');}
    if(this.data?.version!==1||!Array.isArray(this.data.profiles)||this.data.profiles.length>30)throw Error('로그인 저장 파일 형식이 올바르지 않습니다.');
    return this.data;
  }
  async save(data){
    if(this.memoryOnly){const metadata={version:1,activeId:data.activeId,profiles:data.profiles.map(p=>({clientId:p.clientId,subject:p.subject||null,email:p.email||null,credentials:null,pendingRefresh:null}))};const temp=path.join(this.dir,'metadata-'+randomUUID()+'.json');await writeFile(temp,JSON.stringify(metadata),{mode:0o600,flag:'wx'});await rename(temp,path.join(this.dir,'registrations.json'));this.data=structuredClone(data);return;}
    const encrypted=await this.protect(Buffer.from(JSON.stringify(data),'utf8'));const temp=path.join(this.dir,'write-'+randomUUID()+'.auth.enc');
    await writeFile(temp,encrypted,{mode:0o600,flag:'wx'});await rename(temp,path.join(this.dir,'accounts.auth.enc'));this.data=structuredClone(data);
  }
  release(){const lock=path.join(this.dir,'runtime-lock.json');try{if(JSON.parse(readFileSync(lock,'utf8')).instance===this.lockId)unlinkSync(lock);}catch{}if(this.exitHandler)process.removeListener('exit',this.exitHandler);}
}
