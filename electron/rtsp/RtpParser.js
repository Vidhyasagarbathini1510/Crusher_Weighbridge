'use strict';
/**
 * RtpParser.js
 * ----------------------------------------------------------------------------
 * Parses RTP packets (RFC 3550) and peeks at the H.264 payload (RFC 6184).
 *
 * We do NOT fully decode video here — that is FFmpeg's job. This class exists so
 * you can SEE the protocol working: sequence numbers, timestamps, the marker
 * bit, and which NAL units (I-frame, P-frame, SPS, PPS) are arriving. It also
 * detects packet loss by watching for gaps in the sequence number.
 *
 * RTP header (12 bytes, big-endian):
 *
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |V=2|P|X|  CC   |M|     PT      |       sequence number         |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |                           timestamp                           |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * |           synchronization source (SSRC) identifier            |
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * ----------------------------------------------------------------------------
 */

class RtpParser {
  constructor(log = console) {
    this.log = log;
    this.lastSeq = null;   // previous sequence number, to detect loss
    this.payloadType = null;
    this.count = 0;
  }

  configureFromSdp(sdp) {
    const video = sdp.media.find((m) => m.type === 'video');
    if (video) this.payloadType = video.payloadType;
  }

  /**
   * @param {Buffer} pkt  One complete RTP packet (header + payload).
   */
  handlePacket(pkt) {
    if (pkt.length < 12) return; // too short to be a valid RTP header

    const b0 = pkt[0];
    const version = (b0 >> 6) & 0x03;         // must be 2
    const padding = (b0 >> 5) & 0x01;
    const extension = (b0 >> 4) & 0x01;
    const csrcCount = b0 & 0x0f;
          
    const b1 = pkt[1];
    const marker = (b1 >> 7) & 0x01;          // for video: usually last packet of a frame
    const payloadType = b1 & 0x7f;

    const seq = pkt.readUInt16BE(2);          // sequence number: +1 per packet
    const timestamp = pkt.readUInt32BE(4);    // 90 kHz media clock for video
    const ssrc = pkt.readUInt32BE(8);         // stream source identifier

    // The payload starts after the fixed header + any CSRC entries + extension.
    let offset = 12 + csrcCount * 4;
    if (extension && pkt.length >= offset + 4) {
      const extLen = pkt.readUInt16BE(offset + 2); // in 32-bit words
      offset += 4 + extLen * 4;
    }
    const payload = pkt.subarray(offset);

    // ---- Packet-loss detection via the sequence number ----
    if (this.lastSeq !== null) {
      const expected = (this.lastSeq + 1) & 0xffff; // wraps at 65535
      if (seq !== expected) {
        this.log.line('warn', `RTP loss/reorder: expected seq ${expected}, got ${seq}`);
      }
    }
    this.lastSeq = seq;
    this.count += 1;

    const nal = this._describeH264(payload);

    // Log only occasionally so the console stays readable (RTP is high-rate).
    if (this.count % 50 === 0 || marker) {
      this.log.line(
        'rtp',
        `#${seq} ts=${timestamp} m=${marker} pt=${payloadType} ssrc=${ssrc} ` +
          `len=${payload.length} ${nal}`
      );
    }
  }

  /** Identify the H.264 NAL unit type carried in this RTP payload. */
  _describeH264(payload) {
    if (payload.length < 1) return '';
    const nalType = payload[0] & 0x1f; // low 5 bits of the first byte
    const names = {
      1: 'P-slice (non-IDR)',
      5: 'I-slice (IDR keyframe)',
      6: 'SEI',
      7: 'SPS',
      8: 'PPS',
      24: 'STAP-A (aggregated)',
      28: 'FU-A (fragmented frame)',
    };
    if (nalType === 28) {
      // Fragmentation Unit: one large frame split across many RTP packets.
      const start = (payload[1] >> 7) & 1;
      const end = (payload[1] >> 6) & 1;
      const inner = payload[1] & 0x1f;
      return `NAL=FU-A start=${start} end=${end} inner=${inner}`;
    }
    return `NAL=${nalType} (${names[nalType] || 'other'})`;
  }
}

module.exports = RtpParser;
