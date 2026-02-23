const express = require("express");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
app.use(express.json());

const port = process.env.PORT || 4000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: true,
});

// Welcome API endpoint
app.get("/api/welcome", (req, res) => {
  res.json({
    message: "Welcome to the WebRTC Video Chat Application",
    status: "Server is running",
    activeConnections: io.engine.clientsCount,
    serverTime: new Date().toISOString(),
  });
});

// In-memory maps (no database needed)
const emailToSocketIdMap = new Map();
const socketidToEmailMap = new Map();

io.on("connection", (socket) => {
  console.log(`Socket Connected: ${socket.id}`);

  // ── Room Join ─────────────────────────────────────────────────────────────
  socket.on("room:join", (data) => {
    const { email, room } = data;
    emailToSocketIdMap.set(email, socket.id);
    socketidToEmailMap.set(socket.id, email);

    // Notify existing room members that a new user joined
    io.to(room).emit("user:joined", { email, id: socket.id });

    socket.join(room);

    // Confirm join to the joining user
    io.to(socket.id).emit("room:join", data);
  });

  // ── WebRTC Signaling ──────────────────────────────────────────────────────
  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incomming:call", { from: socket.id, offer });
  });

  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });

  socket.on("peer:nego:needed", ({ to, offer }) => {
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });

  socket.on("peer:nego:done", ({ to, ans }) => {
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });

  // ── ICE Candidate Relay ───────────────────────────────────────────────────
  socket.on("ice:candidate", ({ to, candidate }) => {
    io.to(to).emit("ice:candidate", { from: socket.id, candidate });
  });

  // ── Cleanup on Disconnect ─────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const email = socketidToEmailMap.get(socket.id);
    if (email) {
      emailToSocketIdMap.delete(email);
      socketidToEmailMap.delete(socket.id);
    }
    // Notify any peer in the same room
    socket.broadcast.emit("user:left", { id: socket.id });
    console.log(`Socket Disconnected: ${socket.id} (${email || "unknown"})`);
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
