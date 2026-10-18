// Browser recognition only. Never opens a microphone until start() is called by a click.
export function createVoiceInput({Recognition,onText,onInterim=()=>{},onState=()=>{},onMessage=()=>{}}){
  let recognition=null,active=false,stopping=false,failed=false,seen=new Set(),endTimer=null;
  const idle=()=>{clearTimeout(endTimer);recognition=null;active=false;stopping=false;onInterim('');onState(false);};
  const errors={'not-allowed':'마이크 사용이 허용되지 않았습니다. 주소창의 마이크 권한을 확인하거나 직접 입력해 주세요.','service-not-allowed':'이 브라우저의 음성 인식 서비스를 사용할 수 없습니다. 직접 입력해 주세요.','audio-capture':'마이크를 찾지 못했습니다. 연결·장치 선택을 확인해 주세요.','no-speech':'음성이 감지되지 않았습니다. 시작 버튼을 눌러 다시 말해 주세요.','network':'음성 인식 서비스에 연결하지 못했습니다. 인터넷 연결을 확인하거나 직접 입력해 주세요.','language-not-supported':'한국어 음성 인식을 지원하지 않습니다. 직접 입력해 주세요.'};
  return {
    supported:!!Recognition,
    get active(){return active;},
    start(){
      if(!Recognition){onMessage('이 브라우저는 음성 입력을 지원하지 않습니다. Chrome에서 열거나 키보드로 입력해 주세요.');return false;}
      if(active)return false;
      failed=false;seen=new Set();stopping=false;
      const current=recognition=new Recognition();current.lang='ko-KR';current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
      current.onresult=event=>{
        if(recognition!==current)return;let interim='';
        for(let i=event.resultIndex;i<event.results.length;i++){
          const result=event.results[i],text=result[0]?.transcript?.trim()||'';
          if(result.isFinal){if(!seen.has(i)&&text){seen.add(i);onText(text);}}
          else interim+=text+' ';
        }onInterim(interim.trim());
      };
      current.onerror=event=>{if(recognition!==current)return;failed=true;onMessage(errors[event.error]||'음성 입력이 중단됐습니다. 직접 입력하거나 다시 시작해 주세요.');try{current.abort();}catch{}idle();};
      current.onend=()=>{if(recognition!==current)return;idle();if(!failed)onMessage('음성 입력을 마쳤습니다. 답변의 이름·수치·전문 용어를 확인하고 제출해 주세요.');};
      try{active=true;onState(true);current.start();onMessage('마이크 연결 중입니다. 브라우저가 요청하면 마이크 사용을 허용해 주세요.');return true;}
      catch{idle();onMessage('마이크를 시작하지 못했습니다. 권한을 확인하거나 직접 입력해 주세요.');return false;}
    },
    stop({discard=false}={}){
      if(!recognition)return;
      const current=recognition;
      if(discard){recognition=null;try{current.abort();}catch{}idle();return;}
      if(stopping)return;stopping=true;onMessage('마지막 문장을 정리하고 있습니다.');
      try{current.stop();endTimer=setTimeout(()=>{if(recognition===current){try{current.abort();}catch{}idle();onMessage('음성 입력을 마쳤습니다. 답변을 확인해 주세요.');}},3000);}catch{idle();}
    }
  };
}
