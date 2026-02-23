# Video Chat App — Fix Plan

## Issues Found & Fix Order

### ✅ Fix 1 — peer.js: Singleton reset on reconnect
- Problem: RTCPeerConnection is created once; refresh breaks it
- Fix: Add `resetPeer()` method, call it when entering room

### ✅ Fix 2 — Automatic stream sending (no manual "Send Stream" button)
- Problem: Caller must manually click "Send Stream" after call connects
- Fix: Auto-send streams inside `handleCallAccepted`; receiver auto-sends in `handleIncommingCall` after answer

### ✅ Fix 3 — ICE candidate exchange missing
- Problem: ICE candidates are not explicitly exchanged via signaling
- Fix: Add `icecandidate` event listener in peer.js, relay candidates through server

### ✅ Fix 4 — Server: proper CORS config + disconnect cleanup
- Problem: `cors: true` is insecure; disconnected users stay in Maps
- Fix: Add proper CORS origin, add `disconnect` event to clean up Maps

### ✅ Fix 5 — Room.jsx: Peer reset on mount + cleanup on unmount
- Problem: Old peer connection lingers between sessions  
- Fix: Call `peer.resetPeer()` on mount; stop media tracks on unmount

### ✅ Fix 6 — Room.jsx: Show user email instead of socket ID
- Problem: "Connected to abc123xyz" is not user friendly
- Fix: Store + display remote user's email

### ✅ Fix 7 — Full UI overhaul of Room.jsx
- Problem: Raw unstyled HTML, no call controls
- Fix: Proper video layout with mute/camera toggle, end call button

### ✅ Fix 8 — Lobby.jsx: Clean up Tailwind usage (already working via @tailwindcss/vite)
- Already configured correctly, no change needed
