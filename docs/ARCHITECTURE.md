# NORIS CCTV — Architecture & "How every layer works"

This document explains each layer of the stack, why it exists, and how a click on
"Open Camera" turns into moving pixels on screen. Read it alongside
`RTSP-PRIMER.md`, which goes deeper on the wire protocols.

---

## 0. The one thing to understand first (the honest design decision)

There is a subtle redundancy hidden in the original brief: *"implement RTSP from
scratch AND use FFmpeg to decode."*

The truth is: **FFmpeg already speaks RTSP.** If you hand FFmpeg an
`rtsp://user:pass@ip/stream` URL, FFmpeg itself performs OPTIONS → DESCRIBE →
SETUP → PLAY, receives the RTP packets, reassembles H.264, and decodes it. It
does the *entire* job internally.

So doing RTSP "by hand" **and** feeding FFmpeg is duplicated work — unless the
goal is to *learn* and to *observe* the protocol. That is exactly our goal. So we
split responsibilities honestly:

```
                    ┌──────────────────────────────────────────────┐
                    │                 One camera                    │
                    └──────────────────────────────────────────────┘
                                        │
            ┌───────────────────────────┴───────────────────────────┐
            ▼                                                         ▼
 (A) MANUAL RtspClient (our code)                     (B) FFmpeg (battle-tested)
 ─ opens a raw TCP socket                             ─ opens its OWN connection
 ─ sends OPTIONS/DESCRIBE/SETUP/PLAY                  ─ does the handshake again,
 ─ authenticates (Digest/Basic)                         internally
 ─ receives interleaved RTP packets                   ─ depacketizes + decodes
 ─ LOGS everything (seq, ts, NAL type)                ─ outputs MJPEG or fMP4
 ─ proves the camera is reachable/healthy             ─ THIS is what paints pixels
 = the LEARNING + HEALTH-CHECK path                   = the RELIABLE RENDER path
```

* Path **A** gives you the visible, educational RTSP/RTP conversation in the app's
  console. It is real: it authenticates against real cameras and reads real RTP.
* Path **B** gives you a rock-solid picture without reinventing an H.264 decoder.

> If you want the *pure* "no duplication" version, you feed path A's RTP packets
> into FFmpeg's `stdin` instead of giving FFmpeg the URL. We show that command in
> `RTSP-PRIMER.md` (§8). It is more fragile, which is why the URL approach is the
> production default.

---

## 1. Layer-by-layer: what each piece does and why it is needed

### TCP Socket (the bottom of everything)
A TCP socket is a reliable, ordered, two-way byte pipe between two machines,
identified by `(ip, port)`. The OS performs the 3-way handshake
(SYN → SYN-ACK → ACK) when you `connect()`. **Why needed:** RTSP is a
conversation, and TCP guarantees the bytes arrive in order and complete — you
never get half a command. In Node (Electron main) this is the `net` module. See
`electron/socket/TcpSocket.js` and the socket inside `RtspClient.js`.

### RTSP (Real-Time Streaming Protocol, RFC 2326)
The "remote control" for a stream. It is **text-based, like HTTP** (`OPTIONS`,
`DESCRIBE`, `SETUP`, `PLAY`, `PAUSE`, `TEARDOWN`), and it runs over TCP port 554.
It does **not** carry the video itself — it *negotiates* how the video will flow.
**Why needed:** the camera won't send you video until you ask correctly and, on
most cameras, authenticate. See `electron/rtsp/RtspClient.js`.

### RTP (Real-time Transport Protocol, RFC 3550)
The actual video-carrying protocol. After `PLAY`, the camera streams a rapid
sequence of RTP packets. Each has a 12-byte header with a **sequence number**
(detect loss/reorder), a **timestamp** (when to display), a **marker bit**
(end-of-frame), and a **payload type** (which codec). **Why needed:** video is
too big for one packet; RTP chops it into thousands of small, timestamped,
numbered packets. See `electron/rtsp/RtpParser.js`.

### H.264 / H.265 (the codec — the compressed video)
The camera's sensor produces raw frames far too large to send (a single 1080p
raw frame ≈ 3 MB). H.264/H.265 compress this ~100–1000× using **keyframes**
(I-frames, a full picture) and **delta frames** (P/B-frames, only what changed).
Inside RTP, H.264 travels as **NAL units**; big frames are split across packets
with **FU-A** fragmentation. **Why needed:** without compression you could not
stream even one camera over a normal network. FFmpeg (or the browser) turns this
back into displayable frames.

### FFmpeg (the decoder / transcoder)
The universal media Swiss-army knife. We spawn it as a child process. It reads
the RTSP stream, decodes H.264/H.265, and emits either **MJPEG** (one JPEG per
frame — simple) or **fragmented MP4** (H.264 copied, no re-encode — efficient).
**Why needed:** writing a correct, hardware-accelerated H.264 decoder yourself is
a multi-year project; FFmpeg is the standard, correct answer. See
`electron/ffmpeg/`.

### Electron (the desktop runtime)
Electron = Chromium (for the UI) + Node.js (for OS access) in one desktop app.
The **main process** (Node) can open sockets and spawn FFmpeg. The **renderer
process** (Chromium) runs our React UI but is sandboxed and cannot touch the OS.
They talk over **IPC** through a secure `preload.js` bridge. **Why needed:** it
lets us ship a Windows `.exe` that runs React *and* does low-level networking —
something a plain web page can never do (browsers can't open raw TCP sockets).
See `electron/main.js`, `electron/preload.js`.

### React (the user interface)
A component library for building the UI: login, dashboard, the 4/9/16 grid,
single-camera view, management, settings, reports. It receives video frames and
log lines from Electron over IPC and renders them. **Why needed:** a fast,
component-based way to build a responsive multi-camera UI. See `src/`.

### Plain PHP backend (the system of record)
Core PHP + PDO + MySQL, JWT-authenticated REST endpoints. It stores the camera
inventory, users, groups, status, audit logs, and settings. It runs on your
existing cPanel/shared hosting. **Why needed:** the desktop app is per-machine
and stateless about *what cameras exist*; the PHP/MySQL backend is the shared,
multi-user source of truth. See `backend/`.

---

## 2. Process & data-flow map

```
 ┌───────────────────────────── Windows Desktop (Electron app) ─────────────────────────────┐
 │                                                                                           │
 │   RENDERER (Chromium)                         MAIN (Node.js)                              │
 │   ┌────────────────────┐   IPC: camera:open   ┌──────────────────────────────────────┐   │
 │   │  React UI          │ ───────────────────▶ │  cameraHandlers.js                    │   │
 │   │  (pages/components) │                      │    ├── RtspClient  ── TCP ─┐          │   │
 │   │                    │ ◀─ camera:log ─────── │    │   (manual handshake)  │          │   │
 │   │  CameraPlayer      │ ◀─ camera:frame ───── │    └── FFmpeg child proc ──┼── TCP ─┐ │   │
 │   │   <img>/<video>    │      /segment         │                           │        │ │   │
 │   └────────────────────┘                       └───────────────────────────┼────────┼─┘   │
 │            │ REST (JWT)                                                     │        │     │
 └────────────┼───────────────────────────────────────────────────────────── │ ────── │ ────┘
              ▼                                                                ▼        ▼
   ┌──────────────────────┐                                        ┌─────────────────────────┐
   │  PHP + MySQL backend │                                        │   IP Camera (RTSP:554)  │
   │  (cPanel hosting)    │                                        │   H.264/H.265 over RTP  │
   └──────────────────────┘                                        └─────────────────────────┘
```

---

## 3. THE END-TO-END FLOW: "User clicks Open Camera" → live video

```
 [1] User clicks "Open" on a camera tile in React.
      │  React calls window.electronAPI.openCamera({ cameraId, rtsp_url, mode })
      ▼
 [2] preload.js forwards it as IPC "camera:open" to the MAIN process.
      ▼
 [3] cameraHandlers.js starts TWO things in parallel:
      ├─ (A) new RtspClient(url).start()   ← the learning/health path
      └─ (B) new FfmpegMjpeg/Fmp4(url).start()  ← the render path
      ▼
 [4] (A) RtspClient opens a raw TCP socket to camera:554
         OS does SYN → SYN-ACK → ACK (3-way handshake).
      ▼
 [5] (A) RTSP handshake — every request/response is logged to the UI console:
         >>> OPTIONS  rtsp://cam/stream RTSP/1.0   (what can you do?)
         <<< 200 OK   Public: DESCRIBE, SETUP, PLAY, ...
         >>> DESCRIBE ...                          (describe the stream)
         <<< 401 Unauthorized  WWW-Authenticate: Digest realm=..., nonce=...
         >>> DESCRIBE ... Authorization: Digest ...  (retry with credentials)
         <<< 200 OK   [SDP body: m=video ... H264/90000]
         >>> SETUP    Transport: RTP/AVP/TCP;interleaved=0-1
         <<< 200 OK   Session: 12345678
         >>> PLAY     Session: 12345678
         <<< 200 OK
      ▼
 [6] (A) Camera streams RTP packets, interleaved on the SAME TCP socket:
         $  <ch=0> <len> <RTP header + H.264 NAL ...>
         RtpParser logs: #seq ts=... m=... NAL=5 (IDR keyframe)  ← YOU SEE THE VIDEO ARRIVING
      ▼
 [7] (B) In parallel, FFmpeg connects to the same camera, decodes H.264, and
         emits JPEG frames (MJPEG) or fMP4 chunks to its stdout.
      ▼
 [8] cameraHandlers.js reads FFmpeg's stdout and sends each frame/segment to the
     renderer as IPC "camera:frame" / "camera:segment".
      ▼
 [9] CameraPlayer.jsx receives it:
      ├─ MJPEG: wraps the JPEG in a Blob → object URL → <img src>.
      └─ fMP4 : appends the chunk to a MediaSource SourceBuffer → <video>.
      ▼
 [10] Live camera is on screen. The console shows the real protocol conversation.
```

---

## 4. Why this split is the "correct" real-world answer

* **Reliability:** FFmpeg handles the nasty edge cases (B-frames, packet loss
  concealment, SPS/PPS changes, vendor quirks) that a hand-rolled decoder would
  get wrong.
* **Transparency:** the manual client still proves reachability, does auth, and
  exposes the wire protocol for learning and health checks — which FFmpeg hides.
* **Scale path:** switch `mode` from `mjpeg` to `fmp4` and FFmpeg copies H.264
  without re-encoding (`-c:v copy`), so a 16-camera grid stays light on CPU.

See `RTSP-PRIMER.md` for the byte-level protocol details.
