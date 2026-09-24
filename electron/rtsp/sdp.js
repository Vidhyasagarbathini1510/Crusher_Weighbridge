'use strict';
/**
 * sdp.js
 * ----------------------------------------------------------------------------
 * A tiny SDP (Session Description Protocol, RFC 4566) parser. The camera returns
 * SDP in the body of the DESCRIBE response. We only need enough of it to know:
 *   - what media tracks exist (video/audio)
 *   - the dynamic RTP payload type (e.g. 96)
 *   - each track's "control" URL, used in SETUP
 *
 * Example SDP the parser understands:
 *   v=0
 *   m=video 0 RTP/AVP 96
 *   a=rtpmap:96 H264/90000
 *   a=control:trackID=1
 * ----------------------------------------------------------------------------
 */
function parseSdp(text) {
  const media = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('m=')) {
      // m=<type> <port> <proto> <fmt>   e.g. "video 0 RTP/AVP 96"
      const [type, , , fmt] = line.slice(2).split(' ');
      current = { type, payloadType: Number(fmt), codec: null, control: null };
      media.push(current);
    } else if (line.startsWith('a=rtpmap:') && current) {
      // a=rtpmap:96 H264/90000
      const m = /a=rtpmap:\d+\s+([^/]+)\//.exec(line);
      if (m) current.codec = m[1];
    } else if (line.startsWith('a=control:') && current) {
      current.control = line.slice('a=control:'.length);
    }
  }
  return { media };
}

module.exports = { parseSdp };
