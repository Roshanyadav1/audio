import React, { useEffect, useCallback, useState, useRef } from "react";
import ReactPlayer from "react-player";
import peer from "../service/peer";
import { useSocket } from "../context/SocketProvider";
import { useNavigate } from "react-router-dom";

const RoomPage = () => {
  const socket = useSocket();
  const navigate = useNavigate();

  const [remoteSocketId, setRemoteSocketId] = useState(null);
  const [remoteEmail, setRemoteEmail] = useState(null);
  const [myStream, setMyStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [callStatus, setCallStatus] = useState("waiting"); // waiting | calling | connected
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const myStreamRef = useRef(null); // keep latest stream in ref for cleanup

  // ── On mount: reset peer so there's a fresh RTCPeerConnection ────────────
  useEffect(() => {
    peer.resetPeer();

    // Listen for remote tracks
    peer.peer.addEventListener("track", (ev) => {
      setRemoteStream(ev.streams[0]);
      setCallStatus("connected");
    });

    // ICE candidate: send to the other peer via server
    peer.onIceCandidate((candidate) => {
      if (remoteSocketIdRef.current) {
        socket.emit("ice:candidate", {
          to: remoteSocketIdRef.current,
          candidate,
        });
      }
    });

    return () => {
      // Stop all local tracks on unmount
      if (myStreamRef.current) {
        myStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      peer.resetPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a ref to remoteSocketId so ICE cb (registered once) can always see latest
  const remoteSocketIdRef = useRef(null);
  useEffect(() => {
    remoteSocketIdRef.current = remoteSocketId;
  }, [remoteSocketId]);

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
      console.error("Could not get media devices:", err);
      alert("Camera/Microphone access is required for the call.");
      return null;
    }
  }, []);

  // ── Add local tracks to peer connection ──────────────────────────────────
  const sendStreams = useCallback(
    (stream) => {
      const src = stream || myStream;
      if (!src) return;
      const senders = peer.peer.getSenders();
      src.getTracks().forEach((track) => {
        const alreadyAdded = senders.find((s) => s.track === track);
        if (!alreadyAdded) {
          peer.peer.addTrack(track, src);
        }
      });
    },
    [myStream]
  );

  // ── Another user joined the room ─────────────────────────────────────────
  const handleUserJoined = useCallback(({ email, id }) => {
    console.log(`${email} joined the room`);
    setRemoteSocketId(id);
    setRemoteEmail(email);
  }, []);

  // ── Initiate a call ───────────────────────────────────────────────────────
  const handleCallUser = useCallback(async () => {
    const stream = await getLocalStream();
    if (!stream) return;
    sendStreams(stream);
    const offer = await peer.getOffer();
    socket.emit("user:call", { to: remoteSocketId, offer });
    setCallStatus("calling");
  }, [remoteSocketId, socket, getLocalStream, sendStreams]);

  // ── Receive incoming call ─────────────────────────────────────────────────
  const handleIncommingCall = useCallback(
    async ({ from, offer }) => {
      setRemoteSocketId(from);
      const stream = await getLocalStream();
      if (!stream) return;
      console.log("Incoming call from", from);
      const ans = await peer.getAnswer(offer);
      sendStreams(stream);
      socket.emit("call:accepted", { to: from, ans });
      setCallStatus("connected");
    },
    [socket, getLocalStream, sendStreams]
  );

  // ── Call accepted by remote ───────────────────────────────────────────────
  const handleCallAccepted = useCallback(
    async ({ ans }) => {
      await peer.setRemoteDescription(ans);
      console.log("Call accepted!");
      setCallStatus("connected");
    },
    []
  );

  // ── Renegotiation ─────────────────────────────────────────────────────────
  const handleNegoNeeded = useCallback(async () => {
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
  const handleUserLeft = useCallback(
    ({ id }) => {
      if (id === remoteSocketIdRef.current) {
        setRemoteSocketId(null);
        setRemoteEmail(null);
        setRemoteStream(null);
        setCallStatus("waiting");
        peer.resetPeer();
      }
    },
    []
  );

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
    if (!myStream) return;
    myStream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((prev) => !prev);
  }, [myStream]);

  const toggleCamera = useCallback(() => {
    if (!myStream) return;
    myStream.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsCameraOff((prev) => !prev);
  }, [myStream]);

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
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
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
              <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-3xl">
                👤
              </div>
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
              <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center text-3xl">
                📷
              </div>
              <p className="text-sm">Your camera is off</p>
            </div>
          )}
          <span className="absolute bottom-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
            You
          </span>
          {isCameraOff && (
            <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center">
              <span className="text-white text-sm">Camera Off</span>
            </div>
          )}
        </div>
      </div>

      {/* Call action area */}
      <div className="flex flex-col items-center gap-4 pb-8">

        {/* CALL button — shown when someone else is in the room but not yet called */}
        {remoteSocketId && callStatus === "waiting" && (
          <button
            onClick={handleCallUser}
            className="bg-green-500 hover:bg-green-600 text-white font-bold px-10 py-3 rounded-full text-lg shadow-lg transition animate-bounce"
          >
            📞 Call {remoteEmail || "User"}
          </button>
        )}

        {/* Controls — shown when camera is active */}
        {myStream && (
          <div className="flex items-center gap-6">
            <button
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold transition shadow-md
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
              className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold transition shadow-md
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
