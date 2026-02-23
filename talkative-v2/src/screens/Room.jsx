import React, { useEffect, useCallback, useState, useRef } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";
import { useNavigate, useParams } from "react-router-dom";

const RoomPage = () => {
  const socket = useSocket();
  const navigate = useNavigate();
  const { roomId } = useParams();

  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [remoteEmail, setRemoteEmail] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callStatus, setCallStatus] = useState("waiting"); // waiting | calling | connected
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // { from, offer }

  const myStreamRef = useRef(null);
  const remoteSocketIdRef = useRef(null);

  // ── On mount: fresh peer + track listener ───────────────────────────────
  useEffect(() => {
    peer.resetPeer();

    // Listen for remote tracks
    peer.peer.addEventListener("track", (ev) => {
      if (ev.streams && ev.streams[0]) {
        setRemoteStream(ev.streams[0]);
        setCallStatus("connected");
      }
    });

    // ICE candidates → relay
    peer.onIceCandidate((candidate) => {
      if (remoteSocketIdRef.current) {
        socket.emit("ice:candidate", { to: remoteSocketIdRef.current, candidate });
      }
    });

    return () => {
      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      peer.resetPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // ── Auto-rejoin on page refresh ──────────────────────────────────────────
  useEffect(() => {
    const handleReconnect = () => {
      const email = sessionStorage.getItem("talkative_email");
      if (email && roomId) {
        socket.emit("room:join", { email, room: roomId });
      }
    };
    socket.on("connect", handleReconnect);
    return () => socket.off("connect", handleReconnect);
  }, [socket, roomId]);

  // ── Get local camera/mic ─────────────────────────────────────────────────
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      myStreamRef.current = stream;
      setMyStream(stream);
      return stream;
    } catch (err) {
      console.error("Media error:", err);
      alert("Camera/Microphone access is required.");
      return null;
    }
  }, []);

  // ── Add local tracks to peer (no duplicate tracks) ───────────────────────
  // Called AFTER offer/answer — this is what triggers renegotiation
  const sendStreams = useCallback((stream) => {
    const src = stream || myStreamRef.current;
    if (!src) return;
    const senders = peer.peer.getSenders();
    src.getTracks().forEach((track) => {
      const alreadySent = senders.find((s) => s.track === track);
      if (!alreadySent) {
        peer.peer.addTrack(track, src);
      }
    });
  }, []);

  // ── Someone else joined ──────────────────────────────────────────────────
  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`${email} joined the room`);
    setRemoteSocketId(id);
    setRemoteEmail(email);
  }, []);

  // ── Initiate call: getOffer WITHOUT adding tracks yet ───────────────────
  // Tracks are added in handleCallAccepted → triggers renegotiation properly
  const handleCallUser = useCallback(async () => {
    const stream = await getLocalStream();
    if (!stream) return;
    const offer = await peer.getOffer(); // no tracks added yet, intentional
    socket.emit("user:call", { to: remoteSocketIdRef.current, offer });
    setCallStatus("calling");
  }, [socket, getLocalStream]);

  // ── Incoming call: show modal, don't auto-answer ─────────────────────────
  const handleIncommingCall = useCallback(({ from, offer }) => {
    setRemoteSocketId(from);
    setIncomingCall({ from, offer });
  }, []);

  // ── User clicks Answer ────────────────────────────────────────────────────
  const handleAnswerCall = useCallback(async () => {
    if (!incomingCall) return;
    const { from, offer } = incomingCall;
    setIncomingCall(null);
    const stream = await getLocalStream();
    if (!stream) return;
    const ans = await peer.getAnswer(offer); // no tracks yet, same as caller
    socket.emit("call:accepted", { to: from, ans });
    // Add tracks AFTER answer → triggers renegotiation → remote video flows
    sendStreams(stream);
  }, [incomingCall, socket, getLocalStream, sendStreams]);

  const handleDeclineCall = useCallback(() => {
    setIncomingCall(null);
    setRemoteSocketId(null);
    setRemoteEmail(null);
  }, []);

  // ── Caller receives answer: set remote desc + send own tracks ────────────
  const handleCallAccepted = useCallback(
    async ({ ans }) => {
      try {
        await peer.setRemoteDescription(ans);
        console.log("Call Accepted!");
        // Add tracks NOW — this triggers negotiationneeded → renegotiation
        sendStreams();
        setCallStatus("connected");
      } catch (err) {
        console.error("handleCallAccepted error:", err);
      }
    },
    [sendStreams]
  );

  // ── Renegotiation (fires when addTrack is called after stable state) ─────
  const handleNegoNeeded = useCallback(async () => {
    if (peer.peer.signalingState !== "stable") return;
    const offer = await peer.getOffer();
    socket.emit("peer:nego:needed", { offer, to: remoteSocketIdRef.current });
  }, [socket]);

  useEffect(() => {
    peer.peer.addEventListener("negotiationneeded", handleNegoNeeded);
    return () => peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
  }, [handleNegoNeeded]);

  const handleNegoNeedIncomming = useCallback(
    async ({ from, offer }) => {
      const ans = await peer.getAnswer(offer);
      socket.emit("peer:nego:done", { to: from, ans });
    },
    [socket]
  );

  const handleNegoNeedFinal = useCallback(async ({ ans }) => {
    await peer.setRemoteDescription(ans);
  }, []);

  // ── Remote ICE candidates ─────────────────────────────────────────────────
  const handleRemoteIceCandidate = useCallback(({ candidate }) => {
    peer.addIceCandidate(candidate);
  }, []);

  // ── Remote user left ──────────────────────────────────────────────────────
  const handleUserLeft = useCallback(({ id }) => {
    if (id === remoteSocketIdRef.current) {
      setRemoteSocketId(null);
      setRemoteEmail(null);
      setRemoteStream(null);
      setCallStatus("waiting");
      peer.resetPeer();
    }
  }, []);

  // ── Socket bindings ───────────────────────────────────────────────────────
  useEffect(() => {
    socket.on("user:joined", handleUserJoined);
    socket.on("incomming:call", handleIncommingCall);
    socket.on("call:accepted", handleCallAccepted);
    socket.on("peer:nego:needed", handleNegoNeedIncomming);
    socket.on("peer:nego:final", handleNegoNeedFinal);
    socket.on("ice:candidate", handleRemoteIceCandidate);
    socket.on("user:left", handleUserLeft);
    return () => {
      socket.off("user:joined", handleUserJoined);
      socket.off("incomming:call", handleIncommingCall);
      socket.off("call:accepted", handleCallAccepted);
      socket.off("peer:nego:needed", handleNegoNeedIncomming);
      socket.off("peer:nego:final", handleNegoNeedFinal);
      socket.off("ice:candidate", handleRemoteIceCandidate);
      socket.off("user:left", handleUserLeft);
    };
  }, [
    socket, handleUserJoined, handleIncommingCall, handleCallAccepted,
    handleNegoNeedIncomming, handleNegoNeedFinal, handleRemoteIceCandidate, handleUserLeft,
  ]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!myStreamRef.current) return;
    myStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsMuted((p) => !p);
  }, []);

  const toggleCamera = useCallback(() => {
    if (!myStreamRef.current) return;
    myStreamRef.current.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setIsCameraOff((p) => !p);
  }, []);

  const handleEndCall = useCallback(() => {
    if (myStreamRef.current) myStreamRef.current.getTracks().forEach((t) => t.stop());
    peer.resetPeer();
    navigate("/");
  }, [navigate]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Incoming call modal */}
      {incomingCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 flex flex-col items-center gap-5 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-3xl animate-pulse">📞</div>
            <p className="text-white font-semibold text-lg">Incoming call…</p>
            <p className="text-gray-400 text-sm">{remoteEmail || remoteSocketId}</p>
            <div className="flex gap-6 mt-2">
              <button
                onClick={handleDeclineCall}
                className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white text-2xl flex items-center justify-center transition"
                title="Decline"
              >📵</button>
              <button
                onClick={handleAnswerCall}
                className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 text-white text-2xl flex items-center justify-center transition"
                title="Answer"
              >📞</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${callStatus === "connected" ? "bg-green-400 animate-pulse" : "bg-yellow-400 animate-pulse"}`}></span>
          <span className="text-gray-300 text-sm font-medium">
            {callStatus === "waiting" && "Waiting for someone to join…"}
            {callStatus === "calling" && "Calling…"}
            {callStatus === "connected" && `Connected with ${remoteEmail || remoteSocketId}`}
          </span>
        </div>
        <button onClick={handleEndCall} className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition">
          Leave Room
        </button>
      </header>

      {/* Video grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">

        {/* Remote video */}
        <div className="relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-64">
          {remoteStream ? (
            <ReactPlayer playing url={remoteStream} width="100%" height="100%" style={{ objectFit: "cover" }} />
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-3xl">👤</div>
              <p className="text-sm">{remoteEmail ? `Waiting for ${remoteEmail}…` : "No one else is here yet"}</p>
            </div>
          )}
          {remoteEmail && (
            <span className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">{remoteEmail}</span>
          )}
        </div>

        {/* My video */}
        <div className="relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-64">
          {myStream ? (
            <ReactPlayer playing muted url={myStream} width="100%" height="100%" style={{ objectFit: "cover" }} />
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-3xl">📷</div>
              <p className="text-sm">Your camera is off</p>
            </div>
          )}
          <span className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">You</span>
          {isCameraOff && myStream && (
            <div className="absolute inset-0 bg-gray-900/90 flex items-center justify-center">
              <span className="text-white text-sm">Camera Off</span>
            </div>
          )}
        </div>
      </div>

      {/* Call controls */}
      <div className="flex flex-col items-center gap-4 pb-8">

        {/* CALL button — shown when someone is in the room and call hasn't started */}
        {remoteSocketId && callStatus === "waiting" && (
          <button
            onClick={handleCallUser}
            className="bg-green-500 hover:bg-green-600 text-white font-bold px-10 py-3 rounded-full text-lg shadow-lg transition animate-bounce"
          >
            📞 Call {remoteEmail || "User"}
          </button>
        )}

        {/* Mic / End / Camera controls */}
        {myStream && (
          <div className="flex items-center gap-6">
            <button
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition shadow-md text-white
                ${isMuted ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}`}
            >
              {isMuted ? "🔇" : "🎤"}
            </button>
            <button
              onClick={handleEndCall}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white text-2xl flex items-center justify-center shadow-xl transition"
            >
              📵
            </button>
            <button
              onClick={toggleCamera}
              title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition shadow-md text-white
                ${isCameraOff ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"}`}
            >
              {isCameraOff ? "🚫" : "📷"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoomPage;
