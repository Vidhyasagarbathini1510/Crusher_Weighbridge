#!/usr/bin/env python3
"""
ai_engine.py — Crusher Material Classification Microservice
-------------------------------------------------------------------------------
Reads live RTSP camera frames, runs ONNX classification for crusher materials,
maintains a 5-frame temporal window for stability, and emits real-time predictions
to stdout and via local HTTP endpoint (http://127.0.0.1:5050/api/ai/live).

Materials Supported:
- BOULDER
- 40 MM METAL
- 20 MM METAL
- 10 MM METAL
- 6 MM METAL
- M-SAND
- CRUSHER DUST
"""

import sys
import os
import time
import json
import argparse
import threading
from collections import deque

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    import onnxruntime as ort
    ORT_AVAILABLE = True
except ImportError:
    ORT_AVAILABLE = False

try:
    from flask import Flask, jsonify
    from flask_cors import CORS
    FLASK_AVAILABLE = True
except ImportError:
    FLASK_AVAILABLE = False

DEFAULT_LABELS = [
    "BOULDER",
    "40 MM METAL",
    "20 MM METAL",
    "10 MM METAL",

    
    "6 MM METAL",
    "M-SAND",
    "CRUSHER DUST"
]

class MaterialClassifierEngine:
    def __init__(self, rtsp_url="", model_path="python_ai/models/crusher_materials.onnx", window_size=5, confidence_threshold=90.0):
        self.rtsp_url = rtsp_url
        self.model_path = model_path
        self.window_size = window_size
        self.confidence_threshold = confidence_threshold
        
        self.labels = DEFAULT_LABELS
        self.history = deque(maxlen=window_size)
        self.current_prediction = {
            "material": None,
            "confidence": 0.0,
            "stable": False
        }
        
        self.running = False
        self.session = None
        
        self._init_onnx_model()

    def _init_onnx_model(self):
        if ORT_AVAILABLE and os.path.exists(self.model_path):
            try:
                self.session = ort.InferenceSession(self.model_path, providers=['CPUExecutionProvider'])
                print(f"[AI_ENGINE] Loaded ONNX model from {self.model_path}", flush=True)
            except Exception as e:
                print(f"[AI_ENGINE] Could not load ONNX model: {e}", flush=True)

    def preprocess_frame(self, frame):
        # Resize to standard ImageNet 224x224 RGB
        resized = cv2.resize(frame, (224, 224))
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        normalized = rgb.astype(np.float32) / 255.0
        # Standardize (ImageNet mean & std)
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        normalized = (normalized - mean) / std
        # NCHW shape (1, 3, 224, 224)
        chw = np.transpose(normalized, (2, 0, 1))
        tensor = np.expand_dims(chw, axis=0)
        return tensor

    def infer(self, frame):
        if not self.session:
            return None, 0.0

        try:
            tensor = self.preprocess_frame(frame)
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: tensor})
            logits = outputs[0][0]
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / np.sum(exp_logits)
            best_idx = int(np.argmax(probs))
            confidence = float(probs[best_idx] * 100.0)
            material = self.labels[best_idx] if best_idx < len(self.labels) else "UNKNOWN"
            return material, round(confidence, 1)
        except Exception as e:
            return None, 0.0

    def update_stability(self, material, confidence):
        if material is None or confidence < self.confidence_threshold:
            self.history.append((None, 0.0))
            self.current_prediction = {"material": None, "confidence": round(confidence, 1), "stable": False}
            return

        self.history.append((material, confidence))

        # Check if last N frames have identical material label >= threshold
        if len(self.history) == self.window_size:
            all_match = all(m == material and c >= self.confidence_threshold for m, c in self.history)
            if all_match:
                avg_conf = sum(c for _, c in self.history) / float(self.window_size)
                self.current_prediction = {
                    "material": material,
                    "confidence": round(avg_conf, 1),
                    "stable": True
                }
                # Emit JSON payload to stdout for Electron IPC
                payload = json.dumps(self.current_prediction)
                print(f"[AI_PREDICTION] {payload}", flush=True)
                return

        self.current_prediction = {"material": material, "confidence": round(confidence, 1), "stable": False}

    def start_camera_loop(self):
        self.running = True
        if not CV2_AVAILABLE:
            print("[AI_ENGINE] OpenCV (cv2) is not installed. AI engine loop halted.", flush=True)
            return

        if not self.rtsp_url:
            print("[AI_ENGINE] No RTSP URL provided. Standing by...", flush=True)
            return

        print(f"[AI_ENGINE] Connecting to RTSP stream: {self.rtsp_url}", flush=True)
        cap = cv2.VideoCapture(self.rtsp_url)

        fps_delay = 0.2  # ~5 FPS sampling
        while self.running:
            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(1.0)
                continue

            material, confidence = self.infer(frame)
            if material:
                self.update_stability(material, confidence)

            time.sleep(fps_delay)

        cap.release()

# Flask HTTP API Server
app = Flask(__name__)
if FLASK_AVAILABLE:
    CORS(app)

engine = None

@app.route('/api/ai/live', methods=['GET'])
def get_live_prediction():
    if not engine:
        return jsonify({"material": None, "confidence": 0.0, "stable": False})
    return jsonify(engine.current_prediction)

def main():
    parser = argparse.ArgumentParser(description="Crusher Material AI Classification Microservice")
    parser.add_argument("--rtsp_url", type=str, default="", help="RTSP Camera URL")
    parser.add_argument("--model", type=str, default="python_ai/models/crusher_materials.onnx", help="Path to ONNX model")
    parser.add_argument("--port", type=int, default=5050, help="HTTP API Port")
    args = parser.parse_args()

    global engine
    engine = MaterialClassifierEngine(rtsp_url=args.rtsp_url, model_path=args.model)

    # Start RTSP processing loop in background thread
    t = threading.Thread(target=engine.start_camera_loop, daemon=True)
    t.start()

    print(f"[AI_ENGINE] Starting HTTP API on port {args.port}...", flush=True)
    if FLASK_AVAILABLE:
        app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)
    else:
        while True:
            time.sleep(1)

if __name__ == "__main__":
    main()
