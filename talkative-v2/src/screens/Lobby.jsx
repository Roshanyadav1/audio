import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../context/SocketProvider";

const LobbyScreen = () => {
  const [email, setEmail] = useState("");
  const [room, setRoom] = useState("");
  const socket = useSocket();
  const navigate = useNavigate();

  const handleSubmitForm = useCallback(
    (e) => {
      e.preventDefault();
      socket.emit("room:join", { email, room });
    },
    [email, room, socket]
  );

  const handleJoinRoom = useCallback(
    (data) => {
      const { room } = data;
      navigate(`/room/${room}`);
    },
    [navigate]
  );

  useEffect(() => {
    socket.on("room:join", handleJoinRoom);
    return () => {
      socket.off("room:join", handleJoinRoom);
    };
  }, [socket, handleJoinRoom]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      {/* Glow blob */}
      <div className="absolute w-96 h-96 bg-indigo-600 rounded-full blur-3xl opacity-10 pointer-events-none" />

      <div className="relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-3xl shadow-2xl p-8 md:p-10">

        {/* Logo / Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-3xl shadow-lg">
            📹
          </div>
        </div>

        <h1 className="text-2xl md:text-3xl font-bold text-center text-white mb-1">
          Talkative
        </h1>
        <p className="text-center text-gray-400 text-sm mb-8">
          Enter a room ID to start or join a video call
        </p>

        <form onSubmit={handleSubmitForm} className="space-y-5">
          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-1">
              Your Email
            </label>
            <input
              type="email"
              id="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            />
          </div>

          {/* Room ID */}
          <div>
            <label htmlFor="room" className="block text-sm font-medium text-gray-400 mb-1">
              Room ID
            </label>
            <input
              type="text"
              id="room"
              required
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="e.g. my-room-123"
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition text-sm tracking-wide shadow-md"
          >
            Join Room →
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-8">
          React • Socket.IO • WebRTC
        </p>
      </div>
    </div>
  );
};

export default LobbyScreen;
