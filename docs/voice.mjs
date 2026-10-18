// A click requests recognition. Only browser start/audio events confirm that it is listening.
export function createVoiceInput({Recognition,onText,onInterim=()=>{},onState=()=>{},onMessage=()=>{},connectionTimeoutMs=12000,timers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}}){
  let recognition=null,phase='idle',seen=new Set(),hasStarted=false,hasFinal=false,startTimer=null,endTimer=null;
  const publish=next=>{phase=next;onState(phase!=='idle',phase);};
  const clearTimers=()=>{timers.clearTimeout(startTimer);timers.clearTimeout(endTimer);startTimer=endTimer=null;};
  const idle=()=>{clearTimers();recognition=null;onInterim('');publish('idle');};
  const abort=(current,message)=>{if(recognition!==current)return;recognition=null;try{current.abort();}catch{}idle();if(message)onMessage(message);};
  const errors={
    'not-allowed':'마이크 사용이 허용되지 않았습니다(not-allowed). 브라우저의 마이크 허용 상태를 확인하거나 키보드로 입력해 주세요.',
    'service-not-allowed':'현재 브라우저에서 음성 인식 서비스를 사용할 수 없습니다(service-not-allowed). 일반 Chrome에서 같은 면접실을 열거나 키보드로 입력해 주세요.',
    'audio-capture':'마이크에서 소리를 가져오지 못했습니다(audio-capture). 마이크 연결·선택 장치·다른 앱의 점유를 확인해 주세요.',
    'no-speech':'음성이 감지되지 않았습니다(no-speech). 마이크·입력 음량을 확인한 뒤 직접 다시 시작해 주세요.',
    'network':'음성 인식 서비스 연결에 실패했습니다(network). 네트워크·브라우저 지원을 확인해 주세요. 내장 브라우저라면 일반 Chrome에서 같은 주소로 다시 시험할 수 있습니다. 마이크 장치 고장으로 확정된 것은 아닙니다.',
    'language-not-supported':'이 브라우저에서 한국어 음성 인식을 지원하지 않습니다. 키보드로 입력해 주세요.'
  };
  return {
    supported:!!Recognition,
    get active(){return phase!=='idle';},
    get phase(){return phase;},
    get listening(){return phase==='listening';},
    start(){
      if(!Recognition){onMessage('이 브라우저는 음성 입력을 지원하지 않습니다. 일반 Chrome에서 열거나 키보드로 입력해 주세요.');return false;}
      if(phase!=='idle')return false;
      seen=new Set();hasStarted=false;hasFinal=false;
      let current;try{current=new Recognition();}catch{onMessage('이 브라우저에서 음성 인식을 초기화하지 못했습니다. 키보드로 입력해 주세요.');return false;}
      recognition=current;current.lang='ko-KR';current.continuous=true;current.interimResults=true;current.maxAlternatives=1;
      const listening=()=>{if(recognition!==current||phase==='stopping'||hasStarted)return;hasStarted=true;timers.clearTimeout(startTimer);startTimer=null;publish('listening');onMessage('음성 인식이 시작됐습니다. 마이크에 대고 답변해 주세요.');};
      current.onstart=listening;current.onaudiostart=listening;
      current.onresult=event=>{
        if(recognition!==current)return;
        if(!hasStarted)listening();let interim='';
        for(let i=event.resultIndex;i<event.results.length;i++){
          if(recognition!==current)break;
          const result=event.results[i],text=result[0]?.transcript?.trim()||'';
          if(result.isFinal){if(!seen.has(i)&&text){seen.add(i);hasFinal=true;onText(text);}}
          else interim+=text+' ';
        }if(recognition===current)onInterim(interim.trim());
      };
      current.onerror=event=>abort(current,errors[event.error]||'음성 입력이 중단됐습니다. 키보드로 입력하거나 직접 다시 시작해 주세요.');
      current.onend=()=>{if(recognition!==current)return;const message=hasFinal?'음성 입력을 마쳤습니다. 답변의 이름·수치·전문 용어를 확인하고 제출해 주세요.':hasStarted?'인식된 문장이 없습니다. 마이크·입력 음량을 확인하고 다시 시작하거나 키보드로 입력해 주세요.':'음성 인식이 시작되기 전에 연결이 끝났습니다. 마이크 허용 상태와 브라우저 지원을 확인해 주세요.';idle();onMessage(message);};
      publish('connecting');onMessage('마이크·음성 인식 연결을 요청했습니다. 브라우저에 권한 요청이 뜨면 확인해 주세요. 아직 듣기 시작한 상태는 아닙니다.');
      startTimer=timers.setTimeout(()=>abort(current,'음성 인식 시작 응답이 12초 동안 오지 않았습니다. 연결을 중단했습니다. 마이크 허용 상태를 확인하거나 일반 Chrome에서 같은 면접실을 열어 주세요. 자동 재시도하지 않습니다.'),connectionTimeoutMs);
      try{current.start();return true;}catch{abort(current,'마이크를 시작하지 못했습니다. 권한·브라우저 지원을 확인하거나 키보드로 입력해 주세요.');return false;}
    },
    stop({discard=false}={}){
      if(!recognition)return;const current=recognition;
      if(discard){abort(current);return;}
      if(phase==='connecting'){abort(current,'음성 인식 연결을 취소했습니다. 마이크 듣기는 시작되지 않았습니다.');return;}
      if(phase==='stopping')return;
      publish('stopping');onMessage('마지막 문장을 정리하고 있습니다.');
      try{current.stop();if(recognition===current)endTimer=timers.setTimeout(()=>abort(current,hasFinal?'음성 입력을 마쳤습니다. 답변을 확인해 주세요.':'인식된 문장이 없어 입력을 마쳤습니다. 키보드로 입력하거나 직접 다시 시작해 주세요.'),3000);}catch{abort(current,'음성 입력을 마쳤습니다. 입력된 답변을 확인해 주세요.');}
    }
  };
}
