import {parentPort,workerData} from 'node:worker_threads';
import {getDocumentProxy} from 'unpdf';
import yauzl from 'yauzl';
import {SaxesParser} from 'saxes';
import {fileURLToPath} from 'node:url';
import {LocalPDFAssets} from './pdf-assets.mjs';
import {DOCUMENT_LIMITS} from '../docs/document-core.mjs';
const {buffer,extension}=workerData;
function wordBody(data){return new Promise((resolve,reject)=>{
  yauzl.fromBuffer(Buffer.from(data),{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error)return reject(error);
    let entries=0,size=0,text=null,ended=false;
    const fail=e=>{if(ended)return;ended=true;zip.close();reject(e);};
    zip.on('error',fail);zip.on('end',()=>{if(!ended){ended=true;text===null?reject(Error('Word 본문이 없습니다.')):resolve(text);}});
    zip.on('entry',entry=>{
      size+=entry.uncompressedSize;
      if(++entries>512||size>20*1024*1024||(entry.generalPurposeBitFlag&1))return fail(Error('압축 크기·암호 제한입니다.'));
      if(entry.fileName!=='word/document.xml')return zip.readEntry();
      if(entry.uncompressedSize>4*1024*1024)return fail(Error('Word 본문이 너무 큽니다.'));
      zip.openReadStream(entry,(err,stream)=>{
        if(err)return fail(err);let bytes=0,chunks=[];
        stream.on('error',fail);stream.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024){stream.destroy();fail(Error('본문이 너무 큽니다.'));}else chunks.push(chunk);});
        stream.on('end',()=>{if(ended)return;try{
          const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
          const parser=new SaxesParser({xmlns:true});let parts=[],inText=false;
          const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
          parser.on('doctype',()=>{throw Error('DTD는 읽지 않습니다.');});
          parser.on('opentag',tag=>{if(tag.uri===word&&tag.local==='t')inText=true;if(tag.uri===word&&['tab','br'].includes(tag.local))parts.push(tag.local==='tab'?'\t':'\n');});
          parser.on('text',value=>{if(inText)parts.push(value);});
          parser.on('closetag',tag=>{if(tag.uri===word&&tag.local==='t')inText=false;if(tag.uri===word&&tag.local==='p')parts.push('\n');});
          parser.write(xml).close();text=parts.join('');zip.readEntry();
        }catch(e){fail(e);}});
      });
    });zip.readEntry();
  });
});}
try{
  let text='',pages=null,notes=[];
  if(extension==='pdf'){
    if(Buffer.from(buffer).subarray(0,1024).indexOf('%PDF-')<0)throw Error('PDF 파일 형식이 아닙니다.');
    const pdfAssets=import.meta.resolve('pdfjs-dist/package.json');
    const pdf=await getDocumentProxy(new Uint8Array(buffer),{isEvalSupported:false,useWorkerFetch:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,useWasm:false,verbosity:0,BinaryDataFactory:LocalPDFAssets,
      standardFontDataUrl:fileURLToPath(new URL('./standard_fonts/',pdfAssets)).replaceAll('\\','/'),cMapUrl:fileURLToPath(new URL('./cmaps/',pdfAssets)).replaceAll('\\','/'),cMapPacked:true});
    try{
      pages=pdf.numPages;if(pages>DOCUMENT_LIMITS.pages)throw Error('PDF는 30쪽까지입니다. 필요한 쪽만 별도 PDF로 저장해 주세요.');
      for(let i=1;i<=pages;i++){
        const page=await pdf.getPage(i),content=await page.getTextContent();
        const line=content.items.map(item=>item.str===undefined?'':item.str+(item.hasEOL?'\n':' ')).join('').trim();
        if(line)text+='[PDF '+i+'쪽]\n'+line+'\n\n';else notes.push(i+'쪽: 읽을 수 있는 텍스트 없음');
        if(text.length>DOCUMENT_LIMITS.characters)throw Error('본문이 18,000자를 넘습니다. 필요한 부분만 별도 파일로 저장해 주세요.');
        page.cleanup();
      }
    }finally{await pdf.cleanup();await pdf.loadingTask?.destroy();}
    notes.push('표·다단 배치의 읽기 순서는 원문과 대조해 주세요. 이미지 속 글자는 인식하지 않습니다.');
  }else if(extension==='docx'){
    text=await wordBody(buffer);notes.push('Word 본문 XML의 텍스트를 읽었습니다. 머리말·꼬리말·이미지·댓글은 포함하지 않으며 표의 읽기 순서는 확인이 필요합니다.');
  }else{
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('UTF-8 텍스트가 아닙니다. 메모장에서 UTF-8로 저장해 주세요.');}
    if(text.includes('\0'))throw Error('텍스트 파일 형식이 아닙니다.');
  }
  text=text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim();
  if(text.length>DOCUMENT_LIMITS.characters)throw Error('본문이 18,000자를 넘습니다. 필요한 부분만 별도 파일로 저장해 주세요.');
  if(!text)throw Error('읽을 수 있는 본문이 없습니다. 스캔 PDF는 텍스트를 복사할 수 있는 PDF나 TXT로 바꿔 주세요.');
  parentPort.postMessage({result:{text,pages,notes}});
}catch(e){
  const known=/18,000|30쪽|UTF-8|본문이 없습니다|읽을 수 있는 본문|텍스트 파일 형식|PDF 파일 형식/.test(e.message);
  parentPort.postMessage({error:known?e.message:'서류를 읽지 못했습니다. 암호·파일 손상·압축 크기를 확인하거나 TXT로 바꿔 주세요.'});
}
