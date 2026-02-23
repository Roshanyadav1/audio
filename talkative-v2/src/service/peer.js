class PeerService {
  constructor() {
    this.peer = null;
    this._iceCandidateCallback = null;
    this._initPeer();
  }

  _initPeer() {
    if (this.peer) {
      this.peer.close();
    }

    this.peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
    });

    // Forward ICE candidates to whoever is listening
    this.peer.addEventListener("icecandidate", (event) => {
      if (event.candidate && this._iceCandidateCallback) {
        this._iceCandidateCallback(event.candidate);
      }
    });
  }

  // Called when entering a room — ensures a fresh peer
  resetPeer() {
    this._initPeer();
  }

  // Register a callback to receive local ICE candidates
  onIceCandidate(callback) {
    this._iceCandidateCallback = callback;
  }

  // Add a remote ICE candidate received from signaling server
  async addIceCandidate(candidate) {
    if (this.peer && candidate) {
      try {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding ICE candidate:", e);
      }
    }
  }

  async getAnswer(offer) {
    if (this.peer) {
      await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
      const ans = await this.peer.createAnswer();
      await this.peer.setLocalDescription(new RTCSessionDescription(ans));
      return ans;
    }
  }

  async setRemoteDescription(ans) {
    if (this.peer) {
      await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
    }
  }

  async getOffer() {
    if (this.peer) {
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(new RTCSessionDescription(offer));
      return offer;
    }
  }
}

export default new PeerService();
