import {Worker} from 'node:worker_threads';
import {DOCUMENT_LIMITS} from '../docs/document-core.mjs';
export function readDocument({name,data}){
  if(typeof name!=='string'||!name.trim()||name.length>150||/[\\/\x00-\x1f]/.test(name))throw Error('파일 이름을 확인해 주세요.');
  const extension=name.split('.').at(-1).toLowerCase();
  if(!['pdf','docx','txt','md'].includes(extension))throw Error('PDF·DOCX·UTF-8 TXT·MD를 첨부해 주세요. HWP·이미지는 텍스트 PDF로 바꿔 주세요.');
  if(typeof data!=='string'||data.length>Math.ceil(DOCUMENT_LIMITS.bytes/3)*4||!data.length||data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('파일은 5MiB까지 읽을 수 있습니다.');
  const buffer=Buffer.from(data,'base64');
  if(buffer.length>DOCUMENT_LIMITS.bytes)throw Error('파일은 5MiB까지 읽을 수 있습니다.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./document-worker.mjs',import.meta.url),{workerData:{buffer,extension},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:32},execArgv:[],stdout:true,stderr:true});
    worker.stdout.resume();worker.stderr.resume();
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(Error(error)):resolve({name,...result});};
    const timer=setTimeout(()=>finish('서류 읽기가 20초를 넘었습니다. 필요한 부분을 TXT로 저장해 다시 첨부해 주세요.'),20000);
    worker.once('message',m=>finish(m.error,m.result));
    worker.once('error',()=>finish('서류를 읽지 못했습니다. PDF 잠금·파일 손상을 확인하거나 TXT로 바꿔 주세요.'));
    worker.once('exit',()=>{if(!settled)finish('서류 읽기가 중단됐습니다. 파일 크기를 줄이거나 TXT로 바꿔 주세요.');});
  });
}
