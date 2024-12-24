import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:8000');

// eslint-disable-next-line react/prop-types
const AudioCall = ({ email }) => {
  const [isCalling, setIsCalling] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, timestamp, type }]);
  };

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  const getAudioStream = async () => {
    try {
      addLog('Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
        echoCancellation: true,
        noiseSuppression: true
      });
      addLog('Microphone access granted', 'success');
      localStreamRef.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        addLog('Local audio stream connected');
      }
      return stream;
    } catch (error) {
      addLog(`Microphone access error: ${error.message}`, 'error');
      throw error;
    }
  };

  const createPeerConnection = () => {
    try {
      addLog('Creating peer connection...');
      const pc = new RTCPeerConnection(configuration);
      
      pc.ontrack = (event) => {
        addLog('Received remote audio track');
        if (remoteAudioRef.current && event.streams[0]) {
          remoteAudioRef.current.srcObject = event.streams[0];
          addLog('Remote audio stream connected', 'success');
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          addLog('Sending ICE candidate');
          socket.emit('ice-candidate', event.candidate);
        }
      };

      pc.oniceconnectionstatechange = () => {
        addLog(`ICE Connection State: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'connected') {
          setIsConnected(true);
          addLog('Peer connection established', 'success');
        }
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
          addLog('Added local track to peer connection');
        });
      }

      peerConnectionRef.current = pc;
      return pc;
    } catch (error) {
      addLog(`Peer connection error: ${error.message}`, 'error');
      throw error;
    }
  };

  const handleOffer = async (offer) => {
    try {
      addLog('Received call offer');
      const stream = await getAudioStream();
      const pc = createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      addLog('Set remote description');
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addLog('Created and set local answer');
      
      socket.emit('audio-answer', answer);
      addLog('Sent answer to caller');
    } catch (error) {
      addLog(`Error handling offer: ${error.message}`, 'error');
    }
  };

  const startSearching = async () => {
    try {
      addLog('Starting search for peer...');
      await getAudioStream();
      socket.emit('user-status', { 
        email: email, 
        status: 'isSearching' 
      });
      setIsCalling(true);
    } catch (error) {
      addLog(`Search error: ${error.message}`, 'error');
    }
  };

  const startCall = async () => {
    try {
      addLog('Initiating call...');
      const pc = createPeerConnection();
      const offer = await pc.createOffer({
        offerToReceiveAudio: true
      });
      await pc.setLocalDescription(offer);
      addLog('Created and set local offer');
      socket.emit('audio-offer', offer);
      addLog('Sent offer to peer');
    } catch (error) {
      addLog(`Call initiation error: ${error.message}`, 'error');
    }
  };

  const hangUp = () => {
    addLog('Hanging up call...');
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      addLog('Stopped local audio tracks');
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      addLog('Closed peer connection');
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      addLog('Removed remote audio stream');
    }
    setIsCalling(false);
    setIsConnected(false);
    socket.emit('user-status', { 
      email: email, 
      status: 'idle' 
    });
    addLog('Call ended', 'success');
  };

  useEffect(() => {
    socket.on('connect', () => {
      addLog('Connected to signaling server', 'success');
    });

    socket.on('pairing-start', async (roomid) => {
      console.log("found the room id is first " , roomid);

      addLog('Peer found, starting call...');
      await startCall();
    });

    socket.on('audio-offer', handleOffer);

    socket.on('audio-answer', async (answer) => {
      try {
        addLog('Received answer from peer');
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        addLog('Set remote description from answer');
      } catch (error) {
        addLog(`Error processing answer: ${error.message}`, 'error');
      }
    });

    socket.on('ice-candidate', async (candidate) => {
      try {
        if (peerConnectionRef.current) {
          addLog('Processing received ICE candidate');
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
          addLog('Added ICE candidate');
        }
      } catch (error) {
        addLog(`ICE candidate error: ${error.message}`, 'error');
      }
    });

    return () => {
      hangUp();
      socket.off('connect');
      socket.off('pairing-start');
      socket.off('audio-offer');
      socket.off('audio-answer');
      socket.off('ice-candidate');
      addLog('Cleaned up event listeners');
    };
  }, []);

  console.log( "The logs" ,logs);

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Audio Communication</h2>
      <audio ref={localAudioRef} autoPlay />
      <audio ref={remoteAudioRef} autoPlay />
      
      <div className="mt-4">
        {isCalling ? (
          <button 
            onClick={hangUp}
            className="bg-red-500 text-white px-4 py-2 rounded"
          >
            Hang Up
          </button>
        ) : (
          <button 
            onClick={startSearching}
            className="bg-blue-500 text-white px-4 py-2 rounded"
          >
            Start Searching
          </button>
        )}
      </div>

      {isConnected && (
        <p className="mt-4 text-green-500">Connected to peer!</p>
      )}

      <div className="mt-4 max-h-60 overflow-y-auto border rounded p-2">
        <h3 className="font-bold mb-2">Connection Logs:{email}</h3>
        {logs.map((log, index) => (
          <div 
            key={index} 
            className={`text-sm mb-1 ${
              log.type === 'error' ? 'text-red-500' : 
              log.type === 'success' ? 'text-green-500' : 
              'text-gray-700'
            }`}
          >
            [{log.timestamp}] {log.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default AudioCall;