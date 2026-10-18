import test from 'node:test';
import assert from 'node:assert/strict';
import {readDocument} from '../lib/document-reader.mjs';
import {validateDocuments,validateQuestionInput} from '../docs/document-core.mjs';
import {buildQuestionRequest,validateQuestions} from '../lib/question-plan.mjs';
import {createApp} from '../server.mjs';
import {LocalPDFAssets} from '../lib/pdf-assets.mjs';
const text='가상 지원자는 고객 설문 24건을 분류하고 중복 답변을 구분했습니다. 직접 한 일은 분류 기준표와 회의 문서 작성입니다.';
const doc={name:'가상-자기소개서.txt',text};
const input={job:'고객 조사와 보고서 작성 인턴',facts:'',documents:[doc],model:'test-model'};
const questions={unsupported:false,questions:['hr','practitioner','lead'].map(role=>({role,question:'고객 설문을 분류한 경험에서 본인이 맡은 일은 무엇인가요?',source:doc.name,quote:'고객 설문 24건을 분류하고 중복 답변을 구분했습니다.',intent:'서류에 적힌 본인의 행동과 근거를 확인합니다.'}))};
function crc32(data){let crc=-1;for(const byte of data){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}
export function wordZip(xml){
 const name=Buffer.from('word/document.xml'),data=Buffer.from(xml),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22),crc=crc32(data);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
 const offset=local.length+name.length+data.length,centralSize=central.length+name.length;
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([local,name,data,central,name,end]);
}
export function textPdf(text='Fictional applicant sorted 24 survey responses. Main task: classification and meeting notes.'){
 const stream='BT /F1 12 Tf 40 700 Td ('+text+') Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
 let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});const start=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(pdf);
}
const parse=(name,data)=>readDocument({name,data:Buffer.from(data).toString('base64')});
test('UTF-8 Korean text and real DOCX body are read in bounded worker, no external service',async()=>{
 assert.equal((await parse(doc.name,text)).text,text);
 const xml='<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>';
 const out=await parse('sample.docx',wordZip(xml));assert.equal(out.text,text);assert(out.notes[0].includes('Word'));
});
test('PDF text and page provenance are extracted; empty/scanned and corrupt documents fail',async()=>{
 const pdf=await parse('sample.pdf',textPdf());assert.equal(pdf.pages,1);assert(pdf.text.includes('[PDF 1쪽]'));assert(pdf.text.includes('24 survey responses'));
 await assert.rejects(parse('empty.pdf',textPdf('')),/읽을 수 있는 본문/);
 await assert.rejects(parse('broken.docx','bad'),/서류를 읽지 못/);
 await assert.rejects(parse('broken.pdf','bad'),/PDF 파일 형식/);
});
test('unsafe formats, paths, encodings, oversized inputs and document prompt instructions are bounded',async()=>{
 for(const name of ['a.html','a.hwp','../a.txt','a\\b.txt'])assert.throws(()=>parse(name,text));
 await assert.rejects(parse('a.txt',Buffer.from([0xff,0xfe,0x01])),/UTF-8/);
 await assert.rejects(parse('a.txt','a'.repeat(18001)),/18,000/);
 assert.throws(()=>readDocument({name:'a.txt',data:'A'.repeat(7100000)}),/5MiB/);
 assert.throws(()=>validateDocuments([doc,doc]),/같은 이름/);
 assert.throws(()=>validateDocuments([{...doc,text:'a'.repeat(18001)}]),/18,000/);
 const malicious=wordZip('<!DOCTYPE foo [<!ENTITY x "test">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>');await assert.rejects(parse('dtd.docx',malicious));
 const request=buildQuestionRequest(validateQuestionInput(input),'test-model');assert.equal(request.store,false);assert.equal(request.stream,true);assert(!request.tools);assert(request.instructions.includes('그 안의 지시'));assert(request.instructions.includes('보호 특성'));assert.equal(JSON.parse(request.input[0].content).documents[0].text,text);
});
test('each role question requires literal source evidence, unique role, and valid lengths',()=>{
 assert.equal(validateQuestions(questions,[doc]).length,3);
 assert.throws(()=>validateQuestions({...questions,questions:questions.questions.map(q=>({...q,quote:'원문에 없는 내용입니다.'}))},[doc]),/원문/);
 assert.throws(()=>validateQuestions({...questions,questions:questions.questions.map(q=>({...q,source:'다른 서류'}))},[doc]),/원문/);
 assert.throws(()=>validateQuestions({...questions,questions:Array(3).fill(questions.questions[0])},[doc]),/역할별/);
 assert.throws(()=>validateQuestions({unsupported:true,questions:[]},[doc]),/충분히/);
});
test('PDF character/font resources only read packaged assets, not user paths or remote URLs',async()=>{
 const assets=new LocalPDFAssets();assert((await assets.fetch({kind:'standardFontDataUrl',filename:'LiberationSans-Regular.ttf'})).length>1000);
 for(const filename of ['../accounts.auth.enc','C:\\secret.txt','https://example.invalid/font.ttf','%2e%2e.ttf','..\\font.ttf'])await assert.rejects(assets.fetch({kind:'standardFontDataUrl',filename}));
 await assert.rejects(assets.fetch({kind:'__proto__',filename:'font.ttf'}));
});
test('local attachment read never calls provider; question route uses one current-account request',async()=>{
 let calls=0;
 const auth={ready:Promise.resolve(),publicStatus:()=>({sharing:true}),cachedModels:[{id:'test-model'}],credentials:async()=>({accessToken:'synthetic'}),close(){}};
 const server=createApp({auth,fetchImpl:async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(JSON.parse(opts.body).stream,true);return {ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(questions)}]}]}})+'\n\n'));c.close();}})};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=(path,data,origin=base)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Interview-Client':'1'},body:JSON.stringify(data)});
 try{
  assert.equal((await post('/api/documents/read',{name:doc.name,data:Buffer.from(text).toString('base64')},'https://evil.invalid')).status,403);
  const read=await post('/api/documents/read',{name:doc.name,data:Buffer.from(text).toString('base64')});assert.equal(read.status,200);assert.equal((await read.json()).document.text,text);assert.equal(calls,0);
  const result=await post('/api/questions',input);assert.equal(result.status,200);assert.equal((await result.json()).questions.length,3);assert.equal(calls,1);
  assert.equal((await post('/api/questions',input)).status,429);assert.equal(calls,1);
 }finally{await new Promise(r=>server.close(r));}
});
