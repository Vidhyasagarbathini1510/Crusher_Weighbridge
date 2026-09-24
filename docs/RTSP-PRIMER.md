# RTSP / RTP / H.264 — a beginner's byte-level primer

This is the "learning mode" deep dive. It explains the protocols our
`RtspClient.js` and `RtpParser.js` implement, using the exact messages you will
see scroll past in the app's console.

---

## 1. TCP: the reliable byte pipe

Before any RTSP text is exchanged, the operating system opens a TCP connection:

```
  Client                         Camera
    │  ── SYN ──────────────────▶ │   "I want to talk"
    │  ◀───────────── SYN-ACK ──  │   "OK, I'm listening"
    │  ── ACK ──────────────────▶ │   "Great, connected"
    │                             │
    │ ===== reliable ordered byte stream now open on port 554 =====
```

TCP guarantees: bytes arrive **in order**, **without gaps**, and **complete**.
That is why RTSP (a request/response text protocol) uses TCP: you never receive
half a command. In our code this is Node's `net.connect(554, host)`.

---

## 2. RTSP is "HTTP for streams"

RTSP messages look almost identical to HTTP. Each request has a method, a URL, a
version, and headers. Every request MUST carry an incrementing `CSeq` so
responses can be matched to requests.

### OPTIONS — "what methods do you support?"
```
>>> OPTIONS rtsp://192.168.1.10:554/stream1 RTSP/1.0
    CSeq: 1
    User-Agent: NorisCCTV/1.0

<<< RTSP/1.0 200 OK
    CSeq: 1
    Public: OPTIONS, DESCRIBE, SETUP, PLAY, PAUSE, TEARDOWN
```

### DESCRIBE — "describe the stream" (returns SDP)
Most cameras answer the *first* DESCRIBE with `401 Unauthorized` and a challenge:
```
>>> DESCRIBE rtsp://192.168.1.10:554/stream1 RTSP/1.0
    CSeq: 2
    Accept: application/sdp

<<< RTSP/1.0 401 Unauthorized
    CSeq: 2
    WWW-Authenticate: Digest realm="IPCamera", nonce="a1b2c3..."
```
We compute Digest auth and retry (see §3). On success we get **SDP** in the body:
```
<<< RTSP/1.0 200 OK
    CSeq: 3
    Content-Type: application/sdp
    Content-Length: 312

    v=0
    m=video 0 RTP/AVP 96          ← a video track, dynamic payload type 96
    a=rtpmap:96 H264/90000        ← codec is H.264, 90 kHz clock
    a=control:trackID=1           ← the URL suffix to use in SETUP
```

### SETUP — "let's agree how RTP is transported"
We choose **interleaved TCP** so RTP comes back on the *same* socket (simplest to
watch, and firewall-friendly):
```
>>> SETUP rtsp://192.168.1.10:554/stream1/trackID=1 RTSP/1.0
    CSeq: 4
    Transport: RTP/AVP/TCP;unicast;interleaved=0-1

<<< RTSP/1.0 200 OK
    CSeq: 4
    Session: 12345678;timeout=60      ← remember this Session id
    Transport: RTP/AVP/TCP;interleaved=0-1
```
`interleaved=0-1` means: RTP on channel 0, RTCP on channel 1, both multiplexed
onto this TCP connection. (The alternative, `RTP/AVP` over UDP, sends RTP to a
separate UDP port — lower latency but blocked by many firewalls.)

### PLAY — "start sending video"
```
>>> PLAY rtsp://192.168.1.10:554/stream1 RTSP/1.0
    CSeq: 5
    Session: 12345678
    Range: npt=0.000-

<<< RTSP/1.0 200 OK
    CSeq: 5
```
Immediately after this, RTP packets begin to flow.

### PAUSE / TEARDOWN — stop
`PAUSE` halts delivery but keeps the session; `TEARDOWN` ends it and lets the
server free resources. Always TEARDOWN on close so the camera doesn't hit its
session limit.

---

## 3. Digest authentication (the math)

From the challenge we take `realm` and `nonce`, then (RFC 2617):
```
HA1      = MD5( username : realm : password )
HA2      = MD5( method   : uri )
response = MD5( HA1 : nonce : HA2 )
```
and resend the request with:
```
Authorization: Digest username="admin", realm="IPCamera",
               nonce="a1b2c3...", uri="rtsp://...", response="<computed>"
```
Some older cameras use `Basic` auth instead (just `base64(user:pass)`), which we
also support. This code is in `RtspClient._authHeader()`.

---

## 4. RTP packet anatomy

Every video packet after PLAY has this 12-byte header (big-endian):

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|X|  CC   |M|     PT      |       sequence number         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                           timestamp                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           synchronization source (SSRC) identifier            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       payload (H.264 NAL ...)                 |
```

* **V** = version (always 2).
* **M** (marker) = for video, usually set on the *last* packet of a frame — a
  cheap "this frame is complete" signal.
* **PT** (payload type) = 96 here, meaning "the dynamic type defined in the SDP",
  i.e. H.264.
* **sequence number** = +1 every packet. If you see a gap, a packet was lost or
  reordered. `RtpParser` watches for this and logs a warning.
* **timestamp** = 90 kHz media clock. All packets of one frame share a timestamp;
  it advances between frames and tells the decoder *when* to present the frame.
* **SSRC** = an id for this particular stream source.

When interleaved over TCP, each RTP packet is wrapped in a 4-byte framing header
so we know where it starts and ends:
```
 $  <channel:1>  <length:2 big-endian>  <RTP packet of that length>
0x24
```
`RtspClient._onData()` implements exactly this framing state machine.

---

## 5. H.264 inside RTP: NAL units and FU-A

H.264 video is a sequence of **NAL units** (Network Abstraction Layer). The first
payload byte's low 5 bits tell you the type:

| NAL type | Meaning                          |
|---------:|----------------------------------|
| 7        | SPS (sequence parameter set)     |
| 8        | PPS (picture parameter set)      |
| 5        | IDR slice (a **keyframe**)        |
| 1        | non-IDR slice (a **delta frame**) |
| 28       | FU-A (a fragment of a big frame) |
| 24       | STAP-A (several small NALs bundled) |

A keyframe (type 5) is often bigger than one packet, so it is split into many
**FU-A** packets. The FU header carries `start` and `end` bits; you reassemble
from the packet with `start=1` to the one with `end=1`, then hand the rebuilt NAL
to the decoder. `RtpParser._describeH264()` decodes and labels these so you can
watch keyframes and delta frames arrive in the console.

> Full FU-A reassembly into an Annex-B stream that you feed to a decoder is
> genuinely fiddly — this is precisely why we let FFmpeg own the decode path.

---

## 6. Packet loss & jitter

* **Loss detection:** compare each packet's sequence number to `last+1`
  (mod 65536). A gap = loss/reorder. Over TCP-interleaved transport you rarely
  lose packets (TCP retransmits), but you can still see reordering across frame
  boundaries.
* **Jitter:** packets don't arrive perfectly evenly. Real players use a **jitter
  buffer** (hold a few frames, release on a smooth clock using the RTP
  timestamp). FFmpeg and the browser's MSE pipeline handle this for us.
* **What loss looks like on screen:** a lost packet inside a frame shows as
  "smearing"/green blocks until the next keyframe arrives and resets the picture.

---

## 7. FFmpeg command reference

**Simple MJPEG (re-encodes every frame, easy to display in an `<img>`):**
```
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip:554/stream1 \
       -f mpjpeg -q:v 6 -r 15 pipe:1
```

**Production fMP4 (copies H.264, no re-encode, feeds MSE `<video>`):**
```
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip:554/stream1 \
       -an -c:v copy -f mp4 \
       -movflags frag_keyframe+empty_moov+default_base_moof pipe:1
```

**Record to disk (H.264 copy, 10-minute segments):**
```
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip:554/stream1 \
       -c copy -f segment -segment_time 600 -strftime 1 \
       "C:/NorisCCTV/recordings/cam1_%Y%m%d_%H%M%S.mp4"
```

**One-shot snapshot (single JPEG):**
```
ffmpeg -rtsp_transport tcp -i rtsp://user:pass@ip:554/stream1 \
       -frames:v 1 -q:v 2 snapshot.jpg
```

---

## 8. The "purist" option: pipe your OWN RTP into FFmpeg

If you truly want *no duplicated handshake* — your manual client does RTSP, and
FFmpeg only decodes — reassemble the H.264 Annex-B stream from RTP yourself and
write it to FFmpeg's stdin:

```
ffmpeg -f h264 -i pipe:0 -f mpjpeg -q:v 6 pipe:1
```

Your `RtpParser` would need to: strip RTP headers, reassemble FU-A fragments,
prepend Annex-B start codes (`00 00 00 01`) to each NAL, inject SPS/PPS before the
first keyframe, and push the bytes to `ffmpeg.stdin`. This works but is brittle
against real-world camera quirks — which is why the URL-based approach in this
project is the recommended default, with the manual client kept for learning and
health checks.
