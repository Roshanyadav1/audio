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

  const myStreamRef = useRef(null);
  const remoteSocketIdRef = useRef(null);
  // Accumulate remote tracks into a single MediaStream
  const remoteMediaStream = useRef(new MediaStream());

  // ── On mount: reset peer, attach core listeners ───────────────────────────
  useEffect(() => {
    peer.resetPeer();

    // FIX 2: Accumulate tracks robustly into a MediaStream
    const handleTrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream) {
        setRemoteStream(stream);
      } else {
        // ev.streams can be empty — manually add track
        remoteMediaStream.current.addTrack(ev.track);
        setRemoteStream(remoteMediaStream.current);
      }
      setCallStatus("connected");
    };

    peer.peer.addEventListener("track", handleTrack);

    // ICE candidate → relay through server
    peer.onIceCandidate((candidate) => {
      if (remoteSocketIdRef.current) {
        socket.emit("ice:candidate", {
          to: remoteSocketIdRef.current,
          candidate,
        });
      }
    });

    return () => {
      peer.peer.removeEventListener("track", handleTrack);
      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      peer.resetPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync ref with state
  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

  // ── FIX 4: Auto-rejoin room on socket reconnect (handles page refresh) ────
  useEffect(() => {
    const handleReconnect = () => {
      const email = sessionStorage.getItem("talkative_email");
      if (email && roomId) {
        console.log("Reconnecting to room:", roomId, "as", email);
        socket.emit("room:join", { email, room: roomId });
      }
    };
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("connect", handleReconnect);
    };
  }, [socket, roomId]);

  // ── Get local media ───────────────────────────────────────────────────────
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
      console.error("Could not get media:", err);
      alert("Camera/Microphone access is required.");
      return null;
    }
  }, []);

  // ── Add local tracks to peer (guard against duplicates) ───────────────────
  const sendStreams = useCallback((stream) => {
    const src = stream || myStreamRef.current;
    if (!src) return;
    const senders = peer.peer.getSenders();
    src.getTracks().forEach((track) => {
      const alreadyAdded = senders.find((s) => s.track === track);
      if (!alreadyAdded) {
        peer.peer.addTrack(track, src);
      }
    });
  }, []);

  // ── Another user joined the room ─────────────────────────────────────────
  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`${email} joined the room`);
    setRemoteSocketId(id);
    setRemoteEmail(email);
  }, []);

  // ── Initiate call ────────────────────────────────────────────────────────
  const handleCallUser = useCallback(async () => {
    const stream = await getLocalStream();
    if (!stream) return;
    sendStreams(stream);           // Add tracks before offer → SDP has sendrecv
    const offer = await peer.getOffer();
    socket.emit("user:call", { to: remoteSocketIdRef.current, offer });
    setCallStatus("calling");
  }, [socket, getLocalStream, sendStreams]);

  // ── FIX 1: Receive incoming call — tracks added BEFORE getAnswer() ────────
  const handleIncommingCall = useCallback(
    async ({ from, offer }) => {
      setRemoteSocketId(from);
      const stream = await getLocalStream();
      if (!stream) return;
      sendStreams(stream);                          // ← Add tracks FIRST
      const ans = await peer.getAnswer(offer);     // ← Now SDP will be sendrecv
      socket.emit("call:accepted", { to: from, ans });
      setCallStatus("connected");
    },
    [socket, getLocalStream, sendStreams]
  );

  // ── Call accepted ─────────────────────────────────────────────────────────
  const handleCallAccepted = useCallback(async ({ ans }) => {
    await peer.setRemoteDescription(ans);
    console.log("Call accepted!");
    setCallStatus("connected");
  }, []);

  // ── FIX 3: Renegotiation — guard against mid-negotiation duplicate offers ─
  const handleNegoNeeded = useCallback(async () => {
    if (peer.peer.signalingState !== "stable") {
      console.log("Skipping negotiation — not stable:", peer.peer.signalingState);
      return;
    }
    const offer = await peer.getOffer();
    socket.emit("peer:nego:needed", { offer, to: remoteSocketIdRef.current });
  }, [socket]);

  useEffect(() => {
    peer.peer.addEventListener("negotiationneeded", handleNegoNeeded);
    return () => {
      peer.peer.removeEventListener("negotiationneeded", handleNegoNeeded);
    };
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
      remoteMediaStream.current = new MediaStream();
      peer.resetPeer();
    }
  }, []);

  // ── Socket event bindings ─────────────────────────────────────────────────
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
    socket,
    handleUserJoined,
    handleIncommingCall,
    handleCallAccepted,
    handleNegoNeedIncomming,
    handleNegoNeedFinal,
    handleRemoteIceCandidate,
    handleUserLeft,
  ]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!myStreamRef.current) return;
    myStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((prev) => !prev);
  }, []);

  const toggleCamera = useCallback(() => {
    if (!myStreamRef.current) return;
    myStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsCameraOff((prev) => !prev);
  }, []);

  const handleEndCall = useCallback(() => {
    if (myStreamRef.current) {
      myStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    peer.resetPeer();
    navigate("/");
  }, [navigate]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

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
        <button
          onClick={handleEndCall}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-1.5 rounded-full transition"
        >
          Leave Room
        </button>
      </header>

      {/* Video grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-4">

        {/* Remote video */}
        <div className="relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-64">
          {remoteStream ? (
            <ReactPlayer
              playing
              url={remoteStream}
              width="100%"
              height="100%"
              style={{ objectFit: "cover" }}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-3xl">👤</div>
              <p className="text-sm">
                {remoteEmail
                  ? `Waiting for ${remoteEmail} to share video…`
                  : "No one else is here yet"}
              </p>
            </div>
          )}
          {remoteEmail && (
            <span className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
              {remoteEmail}
            </span>
          )}
        </div>

        {/* My video */}
        <div className="relative bg-gray-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-64">
          {myStream ? (
            <ReactPlayer
              playing
              muted
              url={myStream}
              width="100%"
              height="100%"
              style={{ objectFit: "cover" }}
            />
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

        {/* CALL button */}
        {remoteSocketId && callStatus === "waiting" && (
          <button
            onClick={handleCallUser}
            className="bg-green-500 hover:bg-green-600 text-white font-bold px-10 py-3 rounded-full text-lg shadow-lg transition animate-bounce"
          >
            📞 Call {remoteEmail || "User"}
          </button>
        )}

        {/* Controls */}
        {myStream && (
          <div className="flex items-center gap-6">
            <button
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition shadow-md
                ${isMuted ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"} text-white`}
            >
              {isMuted ? "🔇" : "🎤"}
            </button>

            <button
              onClick={handleEndCall}
              title="End Call"
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white text-2xl flex items-center justify-center shadow-xl transition"
            >
              📵
            </button>

            <button
              onClick={toggleCamera}
              title={isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition shadow-md
                ${isCameraOff ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"} text-white`}
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
