# NORIS Weighbridge CCTV Desktop Application
## Complete System Documentation & Codebase File-by-File Guide

This document provides a comprehensive analysis of the **NORIS Weighbridge CCTV Desktop Application**. It details the architectural split, database structure, data communication protocols, and provides a file-by-file explanation of every single component in both the Electron backend (Main Process) and React frontend (Renderer Process).

---

## 1. High-Level Architecture

The application is built using **Electron**, which combines **Node.js** (for low-level operating system access) and **Chromium** (for rendering the frontend user interface) into a unified desktop application wrapper. 

```
                                 [ Windows OS / Hardware ]
                                   │                  │
                RS-232 COM Serial ─┘                  └─ IP Cameras (RTSP:554)
                      │                                        │
                      ▼                                        ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ ELECTRON MAIN PROCESS (Node.js)                                        │
   │                                                                        │
   │   db.js (sql.js SQLite WASM) ◀──▶ syncService.js (REST API Sync)       │
   │         ▲                                 ▲                            │
   │         │                                 │                            │
   │         ▼                                 ▼                            │
   │   cameraHandlers.js ────────────▶ printerService.js                    │
   │    ├─ RtspClient (RTP/TCP)        ├─ Raw ESC/P printer                 │
   │    └─ FFmpeg (MJPEG / fMP4)       └─ Silent HTML print                 │
   │         ▲                                                              │
   └─────────┼──────────────────────────────────────────────────────────────┘
             │ IPC Channels (electronAPI secure bridge)
             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ ELECTRON RENDERER PROCESS (Chromium / React)                           │
   │                                                                        │
   │   App.jsx (Client Routing & Layout Shell)                              │
   │    ├─ Sidebar & Navbar (Live Weight displays, Traffic Alert Lights)    │
   │    ├─ ScaleContext (State management for Gross, Tare, Nett)            │
   │    └─ CameraPlayer.jsx (MSE H.264 fMP4 / MJPEG img playback)           │
   │                                                                        │
   │   Pages (Dashboard, Sales Weighments, Reports, Boulders, Settings)     │
   └────────────────────────────────────────────────────────────────────────┘
```

### Electron's Process Split
1. **The Main Process (`electron/main.js`)**: Runs in a pure Node.js environment. It has full, unrestricted access to the file system, network interfaces, spawning sub-processes, opening TCP sockets, reading RS-232 serial ports, and executing Windows PowerShell commands.
2. **The Renderer Process (`src/main.jsx`)**: Runs inside a sandboxed Chromium window. For security, direct access to the Node.js context is disabled (`contextIsolation: true`, `nodeIntegration: false`). It cannot use `require()`, open sockets, or interact directly with raw hardware.
3. **The Preload Bridge (`electron/preload.js`)**: Exposes a safe, restricted interface known as `window.electronAPI` to the React application. This is the IPC (Inter-Process Communication) gateway where the React UI invokes backend operations and receives serial scale weight or camera logs.

---

## 2. Core Subsystems

### A. RTSP / RTP Video Streaming Pipeline
The app features two distinct video streaming paths triggered in parallel for each active camera:
1. **The Learning/Health-Check Path (`RtspClient.js` + `RtpParser.js`)**: A custom, pure-JavaScript RTSP client that opens a direct TCP socket connection on port 554, performs the standard RTSP handshake (OPTIONS, DESCRIBE, SETUP with interleaved TCP transport, and Digest/Basic authentication), and parses RTP video packets. It logs dynamic payload information, frame timestamps, sequence numbers, and identifies H.264 NAL (Network Abstraction Layer) unit types (I-Frames, P-Frames, SPS, PPS). This prints real-time logs to the UI for monitoring camera health.
2. **The High-Performance Render Path (`FfmpegFmp4.js` / `FfmpegMjpeg.js`)**: Spawns an external FFmpeg binary process.
   * **fMP4 Mode (Production Default)**: Spawns FFmpeg, instructs it to read the camera's RTSP feed, copies the compressed H.264 stream directly without decoding/re-encoding (`-c:v copy`), wraps it in a streamable Fragmented MP4 container, and pushes the binary segments to stdout. React reads these segments via IPC and appends them to a Chromium `MediaSource` SourceBuffer inside an HTML5 `<video>` element, utilizing hardware acceleration with close to zero CPU load.
   * **MJPEG Mode (Legacy Fallback)**: FFmpeg decodes H.264/H.265 and re-encodes the stream into consecutive JPEGs (Motion-JPEG) at a capped 15 FPS. The main process extracts JPEG blocks on Start Of Image (SOI) and End Of Image (EOI) markers, and pushes the raw JPEG images to React, which updates the `src` attribute of a standard `<img>` element. This consumes significant CPU but operates without browser hardware acceleration dependencies.

### B. Weight Scale Readers
The system supports dual-input weighbridge scale readers:
1. **Serial Port Scale Reader (`SerialPortReader.js`)**: Reads weight data directly from hardware indicators connected to physical RS-232 serial ports using the `serialport` Node module. It cleans the incoming stream, isolates numeric characters, manages connection state, and pushes weight changes over IPC.
2. **Network IP Scale Reader (`NetronReader.js`)**: Polls digital weighbridge indicators (such as Netron scale adapters) via HTTP GET requests at configurable intervals. It handles JSON and HTML responses, cleans data, and incorporates a failover mechanism so a brief packet drop does not clear the last-recorded weight.

### C. Printing Engine (`printerService.js`)
Handles weighment tickets and reports:
1. **High-Speed ESC/POS Raw Print (`printRawText`)**: Compiles tickets into raw ESC/P command strings. It writes the text to a temporary file and sends it to the ticket printer using Windows PowerShell `Out-Printer` or Linux `lpr`. This bypasses graphical drivers and prints directly to dot-matrix or thermal ticket printers at high speed.
2. **Silent HTML Print (`printSilentHtml`)**: Generates an invisible background browser window, loads designed HTML templates (using modern fonts, tables, margins), and invokes Chromium's native silent print engine to print slip layouts.

### D. Sync Service (`syncService.js`)
Synchronizes local database records:
1. **FIFO Sync Queue**: Saves transaction records (Boulders, Sales, Yard, Loading Slips) to local SQLite. Upon record entry, it adds a row to `sync_queue` marked as `PENDING`.
2. **Sequential Batch Upload**: The sync service runs every 3 seconds, reads up to 30 pending queue records in FIFO order, validates internet connectivity by checking the target crusher server API, and uploads the records. On success, it marks the queue item as `COMPLETED` and sets the local record's `sync_status = 1`.
3. **Master Data Syncing**: Automatically queries the Crusher REST API every 2 seconds to download the latest master registers (Debitors, Materials, Destinations, Transporters, Contractors, Vehicle Tares) and updates local SQLite tables.

---

## 3. Database Schema

The database utilizes `sql.js` (SQLite compiled to WebAssembly). It maintains an in-memory database and writes to `weighbridge.db` on disk using a debounced, asynchronous worker queue to prevent disk blockages, as well as a synchronous write on application exit.

### Table List & Column Definitions

#### 1. `users` (System Operators)
* `id` (INTEGER, Primary Key, Autoincrement)
* `username` (TEXT, Unique)
* `password_hash` (TEXT)
* `full_name` (TEXT)
* `role` (TEXT, default 'operator')
* `created_at` (DATETIME, default current timestamp)

#### 2. `cameras` (CCTV Stream Configurations)
* `id` (INTEGER, Primary Key, Autoincrement)
* `name` (TEXT)
* `ip_address` (TEXT)
* `rtsp_port` (INTEGER, default 554)
* `stream_path` (TEXT)
* `username` (TEXT)
* `password` (TEXT)
* `group_name` (TEXT)
* `group_id` (INTEGER)
* `is_active` (INTEGER, default 1)
* `status` (TEXT, default 'unknown')
* `last_checked` (TEXT)

#### 3. `transactions` (General Weighbridge Operations)
* `id` (INTEGER, Primary Key, Autoincrement)
* `uuid` (TEXT, Unique)
* `date_time` (TEXT)
* `vehicle_no` (TEXT)
* `party` (TEXT)
* `product` (TEXT)
* `gross` (REAL), `tare` (REAL), `net` (REAL)
* `operator` (TEXT), `card` (TEXT), `vehicle_type` (TEXT), `token` (TEXT)
* `image_path` (TEXT)
* `sync_status` (INTEGER, default 0)
* `dc_num` (TEXT), `contractor` (TEXT), `quarry` (TEXT), `material` (TEXT), `driver` (TEXT), `transporter` (TEXT), `destination` (TEXT)
* `bill_type` (TEXT, default 'NON-GST')
* `created_at` (DATETIME, default current timestamp)

#### 4. `boulders` (Boulder Weighment Subsystem)
* `id` (INTEGER, Primary Key, Autoincrement)
* `uuid` (TEXT, Unique)
* `dc_num` (TEXT), `date_time` (TEXT), `vehicle_no` (TEXT), `contractor` (TEXT), `quarry` (TEXT), `material` (TEXT, default 'BOULDERS')
* `gross` (REAL), `tare` (REAL), `net` (REAL)
* `driver` (TEXT), `transporter` (TEXT), `destination` (TEXT), `operator` (TEXT, default 'Admin')
* `sync_status` (INTEGER, default 0)
* `created_at` (DATETIME, default current timestamp)

#### 5. `sales_weighment_units` (Volume/Unit Weighment Subsystem)
* `id` (INTEGER, Primary Key, Autoincrement)
* `uuid` (TEXT, Unique)
* `dc_num` (TEXT), `your_dc` (TEXT), `date_time` (TEXT), `vehicle_no` (TEXT), `party` (TEXT), `material` (TEXT)
* `unit_type` (TEXT), `units_val` (REAL), `destination` (TEXT), `source` (TEXT), `transporter` (TEXT), `driver` (TEXT), `phone` (TEXT)
* `stationary` (TEXT), `po_number` (TEXT), `po_date` (TEXT), `payment` (TEXT)
* `gross` (REAL), `tare` (REAL), `net` (REAL), `rate` (REAL), `amount` (REAL)
* `bill_type` (TEXT, default 'NON-GST'), `transport` (REAL), `discount` (REAL), `grand_total` (REAL)
* `cash_amount` (REAL), `upi_amount` (REAL), `credit_amount` (REAL)
* `operator` (TEXT, default 'Admin')
* `sync_status` (INTEGER, default 0)
* `created_at` (DATETIME, default current timestamp)

#### 6. `yard_weighments` (Internal Transfer System)
* `id` (INTEGER, Primary Key, Autoincrement)
* `uuid` (TEXT, Unique)
* `dc_num` (TEXT), `date_time` (TEXT), `vehicle_no` (TEXT), `party` (TEXT, default 'YARD'), `material` (TEXT)
* `gross` (REAL), `tare` (REAL), `net` (REAL)
* `card` (TEXT), `driver` (TEXT), `transporter` (TEXT), `destination` (TEXT), `operator` (TEXT, default 'Admin')
* `sync_status` (INTEGER, default 0)
* `created_at` (DATETIME, default current timestamp)

#### 7. `loading_slips` (Sales Slip Pre-Registrations)
* Same fields as `sales_weighment_units` (stores initial vehicle tare information and loading order information before final weighment).

#### 8. `first_weighments` & `second_weighments` (Two-Pass Inbound/Outbound Weighments)
* Stores partial vehicle records (First Weighment holds gross/inbound data, Second Weighment matches vehicle numbers, subtracts weights, and generates the final ticket).

#### 9. `sync_queue` (Synchronization Batch Manager)
* `id` (INTEGER, Primary Key, Autoincrement)
* `table_name` (TEXT) - e.g. 'transactions', 'boulders', 'sales_weighment_units', etc.
* `record_uuid` (TEXT) - Maps to the corresponding table record UUID.
* `status` (TEXT, default 'PENDING') - 'PENDING' | 'FAILED' | 'REJECTED' | 'COMPLETED'.
* `retry_count` (INTEGER, default 0)
* `error_message` (TEXT)
* `created_at` (DATETIME, default current timestamp)

#### 10. `settings` (System Key-Value Registry)
* `key` (TEXT, Unique)
* `value` (TEXT)

---

## 4. Deep-Dive: File-by-File Code Guide

### A. Root Configuration & Boot Files

#### 1. [`package.json`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/package.json)
* **Responsibility**: Project metadata, execution scripts, and npm dependencies.
* **Key Content**: Sets entrypoint to `electron/main.js`. Defines `dev` command using `concurrently` to run the Vite dev server and boot Electron concurrently, using `wait-on` to delay Electron boot until port 5173 responds. Contains packages: `serialport` for serial scale communications, `sql.js` for WebAssembly SQLite databases, and `bcryptjs` for security hashing.

#### 2. [`vite.config.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/vite.config.js)
* **Responsibility**: Development build engine settings.
* **Key Content**: Configures Vite to compile JSX using `@vitejs/plugin-react` and map the root static folder structure.

#### 3. [`index.html`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/index.html)
* **Responsibility**: Mount page for Chromium.
* **Key Content**: Standard shell HTML incorporating `<div id="root"></div>` and importing the `/src/main.jsx` frontend script.

---

### B. Electron Main Process Subfolder (`/electron`)

#### 4. [`electron/main.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/main.js)
* **Responsibility**: System controller and application bootstrap.
* **Key Content**:
  * Registers all standard database operations, serial port access helpers, and print service routines with Electron IPC handlers (`ipcMain.handle`).
  * Spawns Chromium UI windows with secure configurations (`contextIsolation: true`, `nodeIntegration: false`) referencing `preload.js`.
  * Monitors weighbridge indicator parameters (COM settings / Scale Network IP Address) in SQLite. It instantiates the correct parser class (`SerialPortReader` or `NetronReader`) and forwards data stream events over the `netron:data` channel to the React UI.
  * Launches the background databases and sync loops on start.

#### 5. [`electron/preload.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/preload.js)
* **Responsibility**: Inter-Process communication bridge.
* **Key Content**: Implements `contextBridge.exposeInMainWorld('electronAPI', { ... })`. Declares precise, safe IPC handler methods (e.g. `openCamera`, `getCameras`, `addTransaction`, `printHtml`) wrapping `ipcRenderer.invoke()`. This enables the React UI to communicate with OS modules without direct file system or raw execution access.

---

### C. Electron Database Module (`/electron/database`)

#### 6. [`electron/database/db.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/database/db.js)
* **Responsibility**: Local database interface.
* **Key Content**:
  * Utilizes `sql.js` to create or read `weighbridge.db` in the application data folder.
  * Sets up table schemas for weighbridge transactions, user credentials, settings, and sync cues.
  * Implements `saveToDisk` using a 100ms debounce to buffer database write requests, preventing disk I/O bottlenecks.
  * Defines helper methods to execute CRUD operations (e.g. `addTransaction`, `getSettings`, `loginUser`, `markTransactionSynced`, `clearTable`).

---

### D. Electron RTSP & RTP Streaming Modules (`/electron/rtsp` & `/electron/ffmpeg`)

#### 7. [`electron/rtsp/RtspClient.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/rtsp/RtspClient.js)
* **Responsibility**: Custom RTSP network negotiator.
* **Key Content**:
  * Connects a raw TCP socket (`net.connect`) to port 554 on the target camera.
  * Sends standard RTSP request commands (OPTIONS, DESCRIBE, SETUP, PLAY) and handles response parsing.
  * Features a Digest/Basic challenge authentication parser inside `_authHeader()`.
  * Negotiates interleaved TCP transport (`Transport: RTP/AVP/TCP;interleaved=0-1`).
  * Emits parsed RTP video packets to `RtpParser.js`.

#### 8. [`electron/rtsp/sdp.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/rtsp/sdp.js)
* **Responsibility**: Parses SDP (Session Description Protocol) text.
* **Key Content**: Parses DESCRIBE responses to isolate video track suffixes (e.g., `trackID=1`), dynamic payload IDs, and codecs (H.264/H.265) to prepare the RTP parser.

#### 9. [`electron/rtsp/RtpParser.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/rtsp/RtpParser.js)
* **Responsibility**: Parses RTP packet headers.
* **Key Content**:
  * Extracts sequence numbers, 90 kHz timestamp clocks, and marker bits from the 12-byte RTP headers.
  * Implements sequence gap checking to identify packet loss or jitter.
  * Analyzes the H.264 payload byte to identify NAL unit types (SPS, PPS, IDR Keyframes, non-IDR Delta frames, FU-A fragments) and forwards diagnostic logs to the UI.

#### 10. [`electron/ffmpeg/FfmpegFmp4.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/ffmpeg/FfmpegFmp4.js)
* **Responsibility**: production H.264 fMP4 video stream pipeline.
* **Key Content**: Spawns an external FFmpeg sub-process using `-c:v copy` (demuxing the H.264 stream without transcoding). It frames the stream into a fragmented MP4 container (`-movflags frag_keyframe+empty_moov+default_base_moof`) and forwards output chunks to stdout for React MSE decoding.

#### 11. [`electron/ffmpeg/FfmpegMjpeg.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/ffmpeg/FfmpegMjpeg.js)
* **Responsibility**: Motion-JPEG fallback stream pipeline.
* **Key Content**: Spawns FFmpeg to decode the RTSP feed and transcode it to raw multipart JPEG images at a capped 15 FPS. Parses stdout, extracts individual JPEG frames using Start/End-of-Image markers (`0xFFD8` / `0xFFD9`), and triggers IPC handlers to push these frames to React.

#### 12. [`electron/ipc/cameraHandlers.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/ipc/cameraHandlers.js)
* **Responsibility**: Connects camera UI triggers to backend processes.
* **Key Content**: Exposes `camera:open` and `camera:close` IPC methods. When invoked, it initializes the `RtspClient` session for diagnostics, spaws the chosen FFmpeg decoder instance, and maps binary outputs (fMP4 fragments or JPEGs) directly to the renderer IPC channels.

---

### E. Electron Services & Interfaces (`/electron/services` & `/electron/socket`)

#### 13. [`electron/services/syncService.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/services/syncService.js)
* **Responsibility**: Data synchronization service.
* **Key Content**:
  * Schedules a transaction sync loop (every 3s) and a crusher master data download routine (every 2s).
  * Evaluates API URL connections using `http`/`https` queries.
  * Reads `sync_queue`, formats payload objects, uploads records to corresponding API endpoints (Boulders, Sales, Yard), and marks rows as synced in local SQLite upon success.
  * Queries master data registers and updates local registers.

#### 14. [`electron/services/printerService.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/services/printerService.js)
* **Responsibility**: Printing execution backend.
* **Key Content**:
  * `getAvailablePrinters`: Polls system driver profiles.
  * `printRawText`: Writes ESC/P plain-text sequences to temporary files and pipes them to ticket printers using PowerShell.
  * `printSilentHtml`: Instantiates a hidden, headless `BrowserWindow`, loads generated HTML pages, and triggers Chromium's silent background printer thread.

#### 15. [`electron/socket/SerialPortReader.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/socket/SerialPortReader.js)
* **Responsibility**: Physical weighbridge scale connector.
* **Key Content**: Uses the `serialport` module to connect to scale indicators via COM ports. Includes connection retry timers, buffers raw string buffers, strips non-numeric characters, and emits the live weight value over IPC.

#### 16. [`electron/socket/NetronReader.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/socket/NetronReader.js)
* **Responsibility**: Network weight indicator poller.
* **Key Content**: Polls remote scale IP endpoints via HTTP GET. Parses JSON key values (e.g. `raw`, `weight`, `value`) or raw strings, incorporates backoff logic for dropouts, and emits parsed weights over IPC.

#### 17. [`electron/socket/TcpSocket.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/electron/socket/TcpSocket.js)
* **Responsibility**: TCP connection wrapper.
* **Key Content**: Exposes a clean, event-based socket helper class featuring automatic exponential-backoff reconnects.

---

### F. React UI Core Subfolder (`/src`)

#### 18. [`src/main.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/main.jsx)
* **Responsibility**: React app entrypoint.
* **Key Content**: Imports styles, instantiates React DOM rendering, and wraps the main layout tree in `<HashRouter>` to support client-side routing inside Electron.

#### 19. [`src/App.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/App.jsx)
* **Responsibility**: Router, auth guard, and layout shell.
* **Key Content**: Defines route paths (e.g. `/`, `/sales/weighment`, `/reports`) mapping to page views. Implements a `Protected` wrapper component that evaluates authorization tokens via `useAuth()`; unauthorized access is redirected to `/login`, while authenticated routes load inside a grid shell featuring `Sidebar`, `Navbar`, and `Footer` components.

#### 20. [`src/styles.css`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/styles.css)
* **Responsibility**: Central CSS file.
* **Key Content**: Core styling for the application. Uses custom CSS variables, dark/light theme options, responsive margins, sidebar designs, status badges, and table typography.

#### 21. [`src/api/client.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/api/client.js)
* **Responsibility**: API client mapping UI queries to backend IPC handlers.
* **Key Content**: Standardizes method calls (e.g. `api.login`, `api.cameras`, `api.addTransaction`, `api.saveVehicleTare`). When running inside Electron, it invokes `window.electronAPI`; when running in a standalone web browser, it falls back to mock endpoints or direct REST fetch queries.

---

### G. React Context Providers (`/src/context`)

#### 22. [`src/context/AuthContext.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/context/AuthContext.jsx)
* **Responsibility**: Auth provider context.
* **Key Content**: Persists tokens and user metadata in state. Saves session states to `localStorage` on login and clears them upon logout.

#### 23. [`src/context/ScaleContext.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/context/ScaleContext.jsx)
* **Responsibility**: Weighbridge scale provider context.
* **Key Content**:
  * Tracks scale states: vehicle ID, card ID, Gross, Tare, and Nett weights.
  * Includes a `useEffect` hook that listens to the `netron:data` IPC channel to update Gross weights dynamically.
  * Automatically calculates Nett weights using `Math.abs(gross - tare)` whenever Gross or Tare values change.
  * Manages state for traffic light signals (Go, Stop, Alert).

---

### H. React Components (`/src/components`)

#### 24. [`src/components/CameraPlayer.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/CameraPlayer.jsx)
* **Responsibility**: Live camera stream renderer.
* **Key Content**:
  * Mounts video player interfaces that listen to IPC video frame feeds.
  * **fMP4 playback**: Attaches an HTML5 `<video>` element to a `MediaSource` object, adds an H.264 source buffer (`codecs="avc1.42E01E"`), listens to `onSegment` IPC callbacks, and appends stream segments to the source buffer for hardware-accelerated rendering.
  * **MJPEG playback**: Listens to `onFrame` IPC callbacks, compiles frame buffers into blobs (`Blob({type: 'image/jpeg'})`), generates object URLs, and updates the `src` attribute of an `<img>` element while revoking the previous frame URL to prevent memory leaks.
  * Requests Electron to close the video session on component unmount.

#### 25. [`src/components/Navbar.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/Navbar.jsx)
* **Responsibility**: App header console.
* **Key Content**: Displays active screen titles and current timestamps. Integrates a real-time weight display linked to the scale data stream, weighbridge connectivity indicators, a notification panel, a full-screen toggle, and logout actions.

#### 26. [`src/components/Sidebar.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/Sidebar.jsx)
* **Responsibility**: Left side navigation bar.
* **Key Content**: Displays navigation options grouped by department (Dashboard, Boulders Weighment, Sales/Invoices, General Weighbridge, Security Feeds, Reports, Settings). Shows active routing states.

#### 27. [`src/components/Footer.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/Footer.jsx)
* **Responsibility**: App footer status bar.
* **Key Content**: Displays the current logged-in user and role. Shows status indicators for local SQLite database connections and background synchronization queues.

#### 28. [`src/components/CameraCard.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/CameraCard.jsx)
* **Responsibility**: Camera preview card.
* **Key Content**: Standardized card container representing camera details, active statuses, and stream paths.

#### 29. [`src/components/StatusBadge.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/StatusBadge.jsx)
* **Responsibility**: Status badge pill.
* **Key Content**: Visual status pills (e.g. Synced, Pending, Offline).

#### 30. [`src/components/Loader.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/components/Loader.jsx)
* **Responsibility**: UI loading spinner.
* **Key Content**: Visual spinner overlay for data loading states.

---

### I. React Helper Utilities (`/src/utils`)

#### 31. [`src/utils/cameraSnapshot.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/utils/cameraSnapshot.js)
* **Responsibility**: Captures camera snapshots during transactions.
* **Key Content**:
  * `captureCameraSnapshot`: Queries active `video.camera-tile` or `img.camera-tile` elements in the DOM.
  * Renders target frames to a hidden canvas, resizes the canvas to a maximum width of 640px to capture crisp vehicle and license plate details, and exports compressed JPEG strings at a quality level of 0.65.
  * Returns up to two compressed base64 images (~25-30KB) to save to the database and sync without consuming excessive bandwidth.

#### 32. [`src/utils/dcHelper.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/utils/dcHelper.js)
* **Responsibility**: Generates delivery challan numbers.
* **Key Content**: Generates daily sequential DC numbers (e.g. `DC-01`, `DC-02`). Checks the date prefix stored in `localStorage` and resets the counter to 1 when a new day is detected.

#### 33. [`src/utils/printHelper.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/utils/printHelper.js)
* **Responsibility**: Slip printing manager.
* **Key Content**:
  * `PRINTER_TEMPLATES`: Defines available visual designs (Classic Blue, Modern Minimal, Industrial, Professional, Compact, and RAW legacy).
  * `generateSlipHtml`: Assembles details (vehicle, material, weights, dates, operator, barcode fields) into selected styled HTML templates.
  * `generateEscpSlipText`: Generates raw ESC/P command streams for thermal and dot-matrix printers.
  * `printTicket`: Invokes the Electron printer backend (`printRaw` or `printHtml`) based on settings, with fallback options to trigger browser print dialog popups.

#### 34. [`src/utils/reportPrinter.js`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/utils/reportPrinter.js)
* **Responsibility**: Renders and prints reports.
* **Key Content**: Opens clean browser preview windows, populates them with transaction logs, metrics (total weights, ticket counts), table headers, and runs print routines configured for A4 landscape layouts.

---

### J. UI Page Views (`/src/pages`)

#### 35. [`src/pages/Login.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Login.jsx)
* **Responsibility**: User login form.
* **Key Content**: Provides user authorization forms, verifies credentials against `db.js` using bcrypt hashing, and saves session states in the authentication context.

#### 36. [`src/pages/Dashboard.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Dashboard.jsx)
* **Responsibility**: Application dashboard.
* **Key Content**:
  * Shows key performance metrics (Total Transactions, Net Dispatched Weights, Average Weight, Cameras Online).
  * Renders a layout grid showing active CCTV camera players.
  * Displays lists of recent transactions.
  * Provides quick-links and shortcuts for operators.

#### 37. [`src/pages/Boulders.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Boulders.jsx)
* **Responsibility**: Boulder weighment transaction screen.
* **Key Content**: Captures boulder weighment details (DC, Contractor, Quarry, Vehicle, Driver, Transporter, Destination). Reads weights, captures camera snapshots, saves the record, prints the ticket, and updates the sync queue.

#### 38. [`src/pages/BouldersDuplicate.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/BouldersDuplicate.jsx)
* **Responsibility**: Duplicate boulder ticket printer.
* **Key Content**: Searches completed boulder transactions and triggers duplicate prints.

#### 39. [`src/pages/QuarryEnable.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/QuarryEnable.jsx)
* **Responsibility**: Active quarry list manager.
* **Key Content**: Enables operators to toggle quarry states (Active/Inactive) to keep dropdown options clean.

#### 40. [`src/pages/LoadingSlip.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/LoadingSlip.jsx)
* **Responsibility**: Sales order pre-entry slip.
* **Key Content**: Pre-registers incoming vehicles and generates tare records before material loading.

#### 41. [`src/pages/SalesWeighmentUnits.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SalesWeighmentUnits.jsx)
* **Responsibility**: Unit-based sales weighment form.
* **Key Content**: Captures transaction details supporting unit-based calculations. Automatically calculates Nett weights, discounts, unit rates, tax types (GST/NON-GST), and cash/UPI/credit splits. Captures camera snapshots and prints tickets.

#### 42. [`src/pages/SalesWeighment.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SalesWeighment.jsx)
* **Responsibility**: Standard sales weighment form.
* **Key Content**: Standard sales weighment screen using weight-based metrics.

#### 43. [`src/pages/DuplicateBill.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/DuplicateBill.jsx)
* **Responsibility**: Sales duplicate ticket finder.
* **Key Content**: Searches completed sales records, filters by DC or vehicle number, and triggers duplicate prints.

#### 44. [`src/pages/Yard.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Yard.jsx)
* **Responsibility**: Internal yard transfers.
* **Key Content**: Records internal yard vehicle weighments.

#### 45. [`src/pages/YardDuplicate.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/YardDuplicate.jsx)
* **Responsibility**: Yard duplicate ticket finder.
* **Key Content**: Searches and reprints yard weighment tickets.

#### 46. [`src/pages/FirstWeighment.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/FirstWeighment.jsx)
* **Responsibility**: Inbound/First-pass weight capturer.
* **Key Content**: Records initial vehicle entries, registers tare weights, and generates temporary transaction tokens.

#### 47. [`src/pages/SecondWeighment.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SecondWeighment.jsx)
* **Responsibility**: Outbound/Second-pass weight matcher.
* **Key Content**: Retrieves pending first-pass weight tokens by vehicle number, records the final outbound weight, computes the Nett weight, and prints the completed weighment ticket.

#### 48. [`src/pages/DuplicateWeighmentBill.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/DuplicateWeighmentBill.jsx)
* **Responsibility**: General ticket reprint finder.
* **Key Content**: Searches and prints duplicate general first/second pass tickets.

#### 49. [`src/pages/Vehicles.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Vehicles.jsx)
* **Responsibility**: Vehicle tare database manager.
* **Key Content**: Manages registered vehicle records (pre-tare values, ownership types) to speed up operations by referencing pre-tare values.

#### 50. [`src/pages/CameraGrid.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/CameraGrid.jsx)
* **Responsibility**: CCTV grid view.
* **Key Content**: Displays active camera streams in grid layouts (4, 9, or 16 screens) for multi-channel security monitoring.

#### 51. [`src/pages/SingleCamera.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SingleCamera.jsx)
* **Responsibility**: Individual camera diagnostic view.
* **Key Content**: Renders a single camera stream side-by-side with a scrolling terminal console displaying live RTSP handshake logs and RTP parser packets.

#### 52. [`src/pages/Settings.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/Settings.jsx)
* **Responsibility**: System settings manager.
* **Key Content**:
  * Configures printers: raw ESC/P vs HTML driver mode, printer name selector, print copies, and page feeds.
  * Configures scales: selects Serial (COM Port/Baud Rate) or Network IP, and checks connections.
  * Configures cameras: manages RTSP configurations, user logins, and active states.
  * System tools: clears database tables, resets synchronization queues, and manages registered vehicle tares.

#### 53. [`src/pages/SalesSummaryReport.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SalesSummaryReport.jsx)
* **Responsibility**: Sales report generator.
* **Key Content**: Generates sales summaries. Filters by material, party, and date ranges. Displays metric cards and prints reports using `reportPrinter.js`.

#### 54. [`src/pages/SalesCashReport.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/SalesCashReport.jsx)
* **Responsibility**: Cash flow statement report.
* **Key Content**: Tracks payment distributions (Cash, UPI, Credit) to verify register balances.

#### 55. [`src/pages/YardReport.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/YardReport.jsx)
* **Responsibility**: Yard transfers statement report.
* **Key Content**: Displays yard transfer activity reports.

#### 56. [`src/pages/BouldersReport.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/BouldersReport.jsx)
* **Responsibility**: Boulders weighment report.
* **Key Content**: Generates summary reports for boulder scale operations.

#### 57. [`src/pages/NormalReport.jsx`](file:///d:/Noris/noris-cctv-desktop/noris-cctv-desktop/src/pages/NormalReport.jsx)
* **Responsibility**: General weighment report.
* **Key Content**: Generates summaries of inbound and outbound transactions.

---

## 5. Main Workflows & Data Flows

### A. Logging in
```
[User Login Form] ──(username/password)──▶ window.electronAPI.login()
                                                     │
                                           (bcrypt.compareSync)
                                                     │
  [AuthContext State] ◀──(persist JSON/token)◀── [SQLite db.js]
```
1. The operator inputs credentials on `Login.jsx` and clicks **Login**.
2. React invokes `api.login()`, forwarding the payload over the IPC channel to `db.js`.
3. `db.js` queries the `users` table for the matching username, checks the password hash using `bcryptjs`, and returns the user object on success.
4. React receives the user profile and a mock token, saves them in the `AuthContext` state, persists them to `localStorage`, and routes the user to `/`.

### B. Live Weight Streaming
```
[Scale Indicator] ──(Serial COM / TCP Raw)──▶ [SerialPortReader / NetronReader]
                                                             │
                                                  (clean numeric weight)
                                                             │
  [ScaleContext State] ◀─── IPC netron:data ◀────────────────┘
           │
           ├─▶ [Navbar.jsx (Live Display)]
           └─▶ [SalesWeighment.jsx (Auto-fill Gross / Net)]
```
1. During system boot in `main.js`, the scale configuration is retrieved from SQLite.
2. The corresponding reader (`SerialPortReader` or `NetronReader`) is instantiated.
3. The reader connects to the physical port or network IP. Upon receiving weight bytes, it extracts the numeric value.
4. The cleaned weight is sent to the renderer window over the `netron:data` IPC channel.
5. React's `ScaleContext` listens to `onNetronData`, updating its global `gross` state.
6. The `Navbar` displays the live weight, and the active weighment pages read the weight state to auto-calculate Nett weights in real time.

### C. Standard Transaction Execution (e.g. Sales Weighment)
```
1. Operator fills form fields (Vehicle, Party, Material, Rate).
2. Live scale weight displays on screen.
3. Operator clicks "Save & Print".
4. captureCameraSnapshot() captures active <video> / <img> tiles 
   and generates compressed base64 images (~25-30KB).
5. React calls api.addTransaction() with the form details and snapshots.
6. SQLite db.js:
   a. Saves record to the business transaction table.
   b. Inserts a reference row in the `sync_queue` table marked as 'PENDING'.
   c. Debounces writing the memory changes to 'weighbridge.db' on disk.
7. React calls printTicket() to print the receipt (silent HTML or raw ESC/P).
8. syncService.js processes the queue item in the background.
```

### D. Background Sync Engine
```
             [syncService.js Loop (Every 3s)]
                            │
               Reads 'PENDING' queue rows
                            │
              Validates Server Connectivity
                            │
             Uploads to API Server Endpoint
                            │
     ┌──────────────────────┴──────────────────────┐
 (Success)                                     (Failure)
     │                                             │
Marks local record synced (sync_status=1)      Updates retry counts
Marks queue item as 'COMPLETED'                Sets status to 'FAILED'
```

---

## 6. How to Export to PDF

You can easily export this documentation file into a formatted PDF using these methods:

### Method 1: Using VS Code (Recommended)
1. Install the **Markdown PDF** extension by `yzane` in VS Code.
2. Open this markdown file in VS Code.
3. Right-click anywhere in the editor window and select **Markdown PDF: Export (pdf)**.
4. The extension will generate a PDF file in the same directory.

### Method 2: Using your Web Browser
1. Drag and drop this `.md` file into a browser that supports Markdown preview (or open the preview in your markdown editor and copy the HTML).
2. Press `Ctrl + P` (or `Cmd + P` on Mac) to open the print dialog.
3. Set the printer destination to **Save as PDF**.
4. Enable **Background graphics** under options, and click **Save**.
