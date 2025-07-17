import React, { useCallback, useEffect, useState } from 'react'
import ReactPlayer from 'react-player'

function AudioCall({email , socket , roomId}) {
  const [myStream , setMyStream] = useState(null)
  const [remoteStream , setRemoteStream] = useState(null)

  const peer = new RTCPeerConnection({
    iceServers : [
      {
        urls: [
         'stun:stun.l.google.com:19302' ,
         'stun:global.stun.twilio.com:3478',
        ]
      }
    ]
  })
  
  const createOffer = async()=>{
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return offer;
  }

  const createAnswer = async(offer)=>{
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    return answer;
  }

  const setRemoteAnswer =async (ans)=>{
    await peer.setRemoteDescription(ans)
  }

  const sendStream = async (stream)=>{
    const tracks = stream.getTracks() ||[];
    for(const track of tracks){
      peer.addTrack(track , stream);
    }
  }

  ///////

  const handleUserJoined = async({emailId})=>{
    const newOffer = await createOffer();
    socket.emit("call-user" , { emailId , offer : newOffer})
  }

  const handleIncomingCall =async({from , offer})=>{
    const answer = await createAnswer(offer);
    socket.emit("call-accepted" , { emailId : from , answer})
  }

  const handleCallAccept = async({ answer })=>{
    console.log("Call got accepted !" , answer);
    await setRemoteAnswer(answer)
  }

  const getUserMediaStream = useCallback(async()=>{
      const stream = await navigator.mediaDevices.getUserMedia({
        audio:true,
        video:true,
      });
      sendStream(stream);
      setMyStream(stream);
  },[])

  const handleTrackEvent = useCallback(async(ev)=>{
      const stream = ev.streams;
      setRemoteStream(stream[0]);
  },[])

  useEffect(()=>{
    socket.on("user-joined" , handleUserJoined)
    socket.on("incoming-call" , handleIncomingCall)
    socket.on("call-accepted" , handleCallAccept)
    return ()=>{
      socket.off("user-joined" , handleUserJoined)
      socket.off("incoming-call" , handleIncomingCall)
      socket.off("call-accepted" , handleCallAccept)
    }
  },[socket])
  
  useEffect(()=>{
    peer.addEventListener('track' , handleTrackEvent)
    return ()=>{
        peer.removeEventListener('track' , handleTrackEvent)
    }
  },[peer])

  useEffect(()=>{
    getUserMediaStream();
  },[])

  
  return (
    <div>
       Just a normal connection 
       <ReactPlayer url={myStream} autoPlay muted />
      <ReactPlayer url={remoteStream} autoPlay />
      
    </div>
  )
}

export default AudioCall
