export const DOCUMENT_LIMITS={files:3,bytes:5*1024*1024,characters:18000,pages:30};
export function validateDocuments(value=[]){
  if(!Array.isArray(value)||value.length>DOCUMENT_LIMITS.files)throw Error('첨부는 최대 3개입니다.');
  let total=0;
  const out=value.map(d=>{
    if(!d||typeof d.name!=='string'||!d.name.trim()||d.name.length>150||/[\\/\x00-\x1f]/.test(d.name)||typeof d.text!=='string'||!d.text.trim())throw Error('첨부 이름과 본문을 확인해 주세요.');
    total+=d.text.length;
    return {name:d.name,text:d.text.trim()};
  });
  if(total>DOCUMENT_LIMITS.characters)throw Error('첨부 본문 합계는 18,000자까지입니다. 미리보기에서 면접에 필요한 부분만 남겨 주세요.');
  if(new Set(out.map(d=>d.name)).size!==out.length)throw Error('같은 이름의 첨부가 있습니다. 파일 이름을 구분해 주세요.');
  return out;
}
export function validateQuestionInput(v){
  if(!v||typeof v.job!=='string'||!v.job.trim()||v.job.length>6000)throw Error('지원 공고·직무를 6,000자 이내로 입력해 주세요.');
  if(typeof v.facts!=='string'||v.facts.length>8000)throw Error('경험은 8,000자 이내로 입력해 주세요.');
  const documents=validateDocuments(v.documents);
  if(!documents.length)throw Error('먼저 서류를 첨부하고 읽은 본문을 확인해 주세요.');
  return {job:v.job.trim(),facts:v.facts.trim(),documents};
}
