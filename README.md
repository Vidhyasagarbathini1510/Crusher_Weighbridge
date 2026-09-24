# NORIS CCTV Desktop

A Windows desktop CCTV monitoring application that connects to RTSP IP cameras,
performs the RTSP handshake over a raw TCP socket, decodes video with FFmpeg, and
renders live streams inside an Electron + React app. A plain PHP + MySQL backend
handles authentication, camera CRUD, status, and settings.

Built for **Noris Solutions**. House colours: navy `#16263d`, gold `#c08a2d`.

---

## What makes this project different

Most "RTSP in JavaScript" tutorials hand the whole job to a library. This one
does **not** use any RTSP React package or camera-viewer component. Instead it
runs **two paths in parallel** for every camera:

1. **A hand-written RTSP client** (`electron/rtsp/RtspClient.js`) that opens a
   real TCP socket, sends real `OPTIONS / DESCRIBE / SETUP / PLAY / PAUSE /
   TEARDOWN` requests, does Digest/Basic auth by hand, and receives real
   interleaved RTP packets which it parses byte-by-byte. This path exists so you
   can *see* the protocol working, log every packet, and use it as a health
   check.

2. **FFmpeg** (`electron/ffmpeg/*.js`), pointed at the same `rtsp://` URL, which
   does the reliable decoding and produces frames the browser can actually show.

### Why both?

Be aware of an honest truth that most tutorials hide: when you give FFmpeg an
`rtsp://` URL, FFmpeg **already does the entire RTSP handshake, RTP
depacketization, and decode internally**. So a "manual RTSP client *plus*
FFmpeg" is redundant *unless the goal is learning* — which here it is. The manual
client teaches the protocol and monitors link health; FFmpeg does the heavy
lifting that gets pixels on screen. See `docs/ARCHITECTURE.md` for the full
rationale and the "purist" alternative (piping the manual client's reassembled
H.264 into FFmpeg's stdin).

---

## Prerequisites

- **Node.js 18+** and npm
- **FFmpeg** installed and on your `PATH` (run `ffmpeg -version` to confirm).
  In a packaged production build, bundle `ffmpeg.exe` at
  `resources/ffmpeg/ffmpeg.exe` (the Electron main process looks there — see
  `getFfmpegPath()` in `electron/main.js`).
- **PHP 8+** and **MySQL** for the backend (typically your cPanel / shared host).

> Electron ships with the proprietary H.264 codecs, so the fragmented-MP4 / MSE
> render path plays H.264 straight in the `<video>` element. A plain Chromium
> build would not.

---

## Setup

### 1. Backend (PHP + MySQL)

1. Import the schema:
   ```sql
   mysql -u youruser -p yourdb < database/schema.sql
   ```
2. Edit **`backend/config/database.php`** — set `DB_HOST`, `DB_NAME`, `DB_USER`,
   `DB_PASS`, and change `JWT_SECRET` to a long random string.
3. Upload the `backend/` folder to your host (e.g.
   `https://cctv.norissolutions.com/api`).
4. Default login: **`admin` / `admin123`** (bcrypt hash is in the schema —
   change it in production).

### 2. Frontend + Electron

1. Install dependencies:
   ```bash
   npm install
   ```
2. Edit **`src/api/client.js`** — set `BASE_URL` to your backend URL.
3. Run in development (starts Vite + Electron together):
   ```bash
   npm run dev
   ```
4. Build a production bundle:
   ```bash
   npm run build
   npm start
   ```

---

## Folder structure

```
noris-cctv-desktop/
├── electron/                  Electron main process (Node.js side)
│   ├── main.js                App entry, window, FFmpeg path resolver
│   ├── preload.js             Secure contextBridge → window.electronAPI
│   ├── ipc/
│   │   └── cameraHandlers.js  open/close/pause; wires RTSP + FFmpeg → renderer
│   ├── rtsp/
│   │   ├── RtspClient.js      HAND-WRITTEN RTSP 1.0 client (the core)
│   │   ├── RtpParser.js       RTP header + H.264 NAL parsing, loss detection
│   │   └── sdp.js             minimal SDP parser
│   ├── socket/
│   │   └── TcpSocket.js       reusable TCP wrapper w/ auto-reconnect
│   └── ffmpeg/
│       ├── FfmpegMjpeg.js     rtsp → MJPEG frames (simple <img> path)
│       └── FfmpegFmp4.js      rtsp → fragmented MP4 (low-CPU MSE <video> path)
├── src/                       React renderer (Vite)
│   ├── main.jsx, App.jsx, styles.css
│   ├── api/client.js          fetch wrapper for all 8 endpoints
│   ├── context/AuthContext.jsx
│   ├── components/            CameraPlayer, CameraCard, Navbar, Sidebar,
│   │                          StatusBadge, Loader
│   └── pages/                 Login, Dashboard, CameraGrid, SingleCamera,
│                              CameraManagement, Settings, Reports
├── backend/                   Plain PHP + PDO REST API (no framework)
│   ├── config/database.php    PDO singleton + JWT/DB constants
│   ├── helpers/
│   │   ├── response.php        cors(), json_ok(), json_err(), body()
│   │   └── auth.php            dependency-free JWT HS256 + require_auth()
│   ├── login.php  logout.php
│   ├── cameras.php  camera-add.php  camera-update.php  camera-delete.php
│   ├── camera-status.php  settings.php
├── database/schema.sql        6 tables, keys, indexes, sample data
├── docs/
│   ├── ARCHITECTURE.md        every layer explained + full end-to-end flow
│   └── RTSP-PRIMER.md         byte-level RTSP / RTP / H.264 walkthrough
├── package.json  vite.config.js  index.html
└── README.md
```

---

## API endpoints

| Method | Endpoint             | Purpose                          |
|--------|----------------------|----------------------------------|
| POST   | `/login.php`         | authenticate, return JWT         |
| POST   | `/logout.php`        | audit logout                     |
| GET    | `/cameras.php`       | list cameras (rtsp_url built server-side, password stripped) |
| POST   | `/camera-add.php`    | create camera                    |
| PUT    | `/camera-update.php` | update camera (whitelisted cols) |
| DELETE | `/camera-delete.php` | delete camera                    |
| GET    | `/camera-status.php` | read status; POST upserts online/offline |
| GET    | `/settings.php`      | read/update key-value settings   |

All protected endpoints expect `Authorization: Bearer <jwt>`.

---

## Where to learn the internals

- **`docs/ARCHITECTURE.md`** — what every layer does (TCP, RTSP, RTP, H.264,
  FFmpeg, Electron, React, PHP), the process/data-flow map, and the complete
  10-step "click Open Camera → live video" trace.
- **`docs/RTSP-PRIMER.md`** — the TCP 3-way handshake, RTSP-as-HTTP with real
  request/response examples, the Digest auth maths, an RTP header diagram, the
  H.264 NAL / FU-A table, and an FFmpeg command reference.

---

## Notes & caveats

- Sample camera paths in the schema use Hikvision
  (`/Streaming/Channels/101`) and Dahua (`/cam/realmonitor?...`) URL formats as
  examples — adjust for your hardware.
- The manual RTSP client uses **interleaved RTP over TCP**
  (`Transport: RTP/AVP/TCP;interleaved=0-1`) so everything travels on one
  firewall-friendly socket you can observe.
- `Reports` is a status table rather than full paginated `camera_logs` — the
  streaming core, PHP API, and docs were prioritised.
- The PHP could not be lint-checked in the build sandbox (no PHP runtime
  available there); it was written by hand against PHP 8 + PDO conventions.
  Test it on your host.
