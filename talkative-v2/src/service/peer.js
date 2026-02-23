class PeerService {
  constructor() {
    this.peer = null;
    this._iceCandidateCallback = null;
    this._initPeer();
  }

  _initPeer() {
    // Close old connection cleanly
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.ontrack = null;
      this.peer.onnegotiationneeded = null;
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

    // Relay local ICE candidates
    this.peer.addEventListener("icecandidate", (event) => {
      if (event.candidate && this._iceCandidateCallback) {
        this._iceCandidateCallback(event.candidate);
      }
    });
  }

  resetPeer() {
    this._iceCandidateCallback = null;
    this._initPeer();
  }

  onIceCandidate(callback) {
    this._iceCandidateCallback = callback;
  }

  async addIceCandidate(candidate) {
    if (this.peer && candidate) {
      try {
        await this.peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        // Ignore benign ICE errors (e.g. candidate added after end-of-candidates)
        console.warn("ICE candidate warning:", e.message);
      }
    }
  }

  async getOffer() {
    if (!this.peer) return null;
    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(new RTCSessionDescription(offer));
    return offer;
  }

  async getAnswer(offer) {
    if (!this.peer) return null;
    await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await this.peer.createAnswer();
    await this.peer.setLocalDescription(new RTCSessionDescription(ans));
    return ans;
  }

  async setRemoteDescription(ans) {
    if (!this.peer) return;
    await this.peer.setRemoteDescription(new RTCSessionDescription(ans));
  }
}

export default new PeerService();
