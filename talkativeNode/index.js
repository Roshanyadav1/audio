const dotenv = require("dotenv");

const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors');
const connection = require('./connect/connection');
const User = require('./models/User');


dotenv.config();

const app = express();
const server = http.createServer(app);


const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
];

// Socket.io CORS configuration
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,// Allow the frontend to connect from this origin
    methods: ['GET', 'POST'], // Allow these HTTP methods
    allowedHeaders: ['Content-Type'], // Specify allowed headers
    credentials: true, // Allow credentials (cookies, authentication)
  },
});

app.use(cors()); // Express CORS middleware

// Serve static files for front-end (optional, if you want to serve HTML pages)
app.use(express.static('public'));

const mongoURI = process.env.MONGO_URI
connection(mongoURI);

const activeConnections = new Map();
const activeRooms = new Map();

const updateUserStatus = async (email, status) => {
  try {
    await User.findOneAndUpdate(
      { email },
      { $set: { status, lastActive: new Date() } },
      { new: true }
    );
  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user-status', async ({ email, status }) => {
    try {
      const user = await User.findOneAndUpdate(
        { email },
        { $set: { status, lastActive: new Date() } },
        { new: true }
      );

      if (!user) {
        socket.emit('error', 'User not found');
        return;
      }

      activeConnections.set(socket.id, { email, status });

      if (status === 'isSearching') {
        const availablePeer = Array.from(activeConnections.entries())
          .find(([id, data]) => 
            id !== socket.id && 
            data.status === 'isSearching'
          );

        if (availablePeer) {
          const roomId = `${socket.id}-${availablePeer[0]}`;
          activeRooms.set(roomId, [socket.id, availablePeer[0]]);
          
          // Update both users' status to 'inCall'
          await Promise.all([
            updateUserStatus(email, 'inCall'),
            updateUserStatus(availablePeer[1].email, 'inCall')
          ]);

          socket.join(roomId);
          io.sockets.sockets.get(availablePeer[0])?.join(roomId);
          
          // Update connection tracking
          activeConnections.set(socket.id, { email, status: 'inCall' });
          activeConnections.set(availablePeer[0], { ...availablePeer[1], status: 'inCall' });

          io.to(roomId).emit('pairing-start', { roomId });
        }
      }
    } catch (error) {
      console.error('User status error:', error);
      socket.emit('error', 'Internal server error');
    }
  });

  socket.on('audio-offer', ({ offer, roomId }) => {
    socket.to(roomId).emit('audio-offer', offer);
  });

  socket.on('audio-answer', ({ answer, roomId }) => {
    socket.to(roomId).emit('audio-answer', answer);
  });

  socket.on('ice-candidate', ({ candidate, roomId }) => {
    socket.to(roomId).emit('ice-candidate', candidate);
  });

  socket.on('end-call', async ({ roomId }) => {
    const users = activeRooms.get(roomId);
    if (users) {
      for (const userId of users) {
        const userData = activeConnections.get(userId);
        if (userData) {
          await updateUserStatus(userData.email, 'online');
          activeConnections.set(userId, { ...userData, status: 'online' });
        }
      }
      io.to(roomId).emit('call-ended');
      activeRooms.delete(roomId);
    }
  });

  socket.on('disconnect', async () => {
    const userData = activeConnections.get(socket.id);
    if (userData) {
      await updateUserStatus(userData.email, 'offline');
      
      const roomId = Array.from(activeRooms.entries())
        .find(([_, users]) => users.includes(socket.id))?.[0];

      if (roomId) {
        const otherUser = activeRooms.get(roomId)?.find(id => id !== socket.id);
        if (otherUser) {
          const otherUserData = activeConnections.get(otherUser);
          if (otherUserData) {
            await updateUserStatus(otherUserData.email, 'online');
          }
        }
        io.to(roomId).emit('call-ended');
        activeRooms.delete(roomId);
      }
    }
    activeConnections.delete(socket.id);
    console.log('User disconnected:', socket.id);
  });
});


// Sample route to get users from the 'users' collection
app.get('/users', async (req, res) => {
    try {
      // Query the 'users' collection
      const users = await User.find(); // Get all users
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});


app.get('/online-users', async (req, res) => {
  try {
    const users = await User.find({ 
      status: { $in: ['online', 'isSearching'] }
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});