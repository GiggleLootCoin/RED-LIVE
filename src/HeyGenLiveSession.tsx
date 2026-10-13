import React,{useEffect,useRef,useState}from"react";
import{LiveAvatarSession,SessionState}from"@heygen/liveavatar-web-sdk";

type Props={
  token:string;
  onEnded:()=>void;
  onError:(message:string)=>void;
  onStatus:(status:string)=>void;
  onSessionReady?:(session:LiveAvatarSession)=>void;
};

export default function HeyGenLiveSession({token,onEnded,onError,onStatus,onSessionReady}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);
  const sessionRef=useRef<LiveAvatarSession|null>(null);
  const [state,setState]=useState<string>("CONNECTING");
  const [talking,setTalking]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    const session=new LiveAvatarSession(token,{autoKeepAlive:true,voiceChat:{}});
    sessionRef.current=session;
    onSessionReady?.(session);

    const attach=()=>{
      if(cancelled)return;
      try{session.attach(videoRef.current!)}catch{}
    };
    const timer=window.setInterval(attach,350);

    const handleState=(next:any)=>{
      const value=String(next);
      if(cancelled)return;
      setState(value);
      onStatus(value);
      if(value===SessionState.DISCONNECTED){
        window.clearInterval(timer);
        onEnded();
      }
    };
    const handleSpeak=()=>setTalking(true);
    const handleSpeakEnd=()=>setTalking(false);

    session.on("session.state_changed" as any,handleState);
    session.on("session.stream_ready" as any,attach);
    session.on("avatar.speak_started" as any,handleSpeak);
    session.on("avatar.speak_ended" as any,handleSpeakEnd);

    session.start().catch((e:any)=>{
      window.clearInterval(timer);
      if(!cancelled)onError(e?.message||"HeyGen LiveAvatar could not start.");
    });

    return()=>{
      cancelled=true;
      window.clearInterval(timer);
      try{session.removeAllListeners()}catch{}
      void session.stop().catch(()=>{});
      sessionRef.current=null;
    };
  },[token,onEnded,onError,onStatus,onSessionReady]);

  return <div className="heygenLiveFrame">
    <video ref={videoRef} autoPlay playsInline className="avatarMedia" />
    <div className="heygenStatus">
      <span className={state==="CONNECTED"?"liveDot":""}/>{state==="CONNECTED"?(talking?"SPEAKING":"LIVE NOW"):state}
    </div>
  </div>;
}
