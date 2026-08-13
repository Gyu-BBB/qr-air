import QRCode from "qrcode";
import jsQR from "jsqr";
import "./style.css";
import {
  assembleFrames,
  base64ToBytes,
  createFrame,
  makeSessionId,
  parseFrame,
  sha256,
} from "./protocol.js";

document.querySelector("#app").innerHTML = `
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="QR Air 홈">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>QR Air</span>
      </a>
      <span class="offline-badge"><i></i> 기기간 직접 전송</span>
    </header>

    <section class="hero">
      <p class="eyebrow">NO NETWORK. JUST LIGHT.</p>
      <h1>파일을 빛으로<br />건네세요.</h1>
      <p class="lead">와이파이도, 블루투스도 필요 없습니다.<br />한쪽 화면을 다른 쪽 카메라로 바라보기만 하세요.</p>
    </section>

    <nav class="mode-tabs" aria-label="전송 모드">
      <button class="mode-tab active" data-mode="send"><span class="tab-icon">↗</span><span><b>보내기</b><small>파일을 QR로 표시</small></span></button>
      <button class="mode-tab" data-mode="receive"><span class="tab-icon">⌁</span><span><b>받기</b><small>카메라로 QR 읽기</small></span></button>
    </nav>

    <section id="send-panel" class="panel active">
      <div id="drop-zone" class="drop-zone">
        <div class="drop-icon">＋</div>
        <h2>보낼 파일을 선택하세요</h2>
        <p>여기에 끌어놓거나 탭해서 선택</p>
        <input id="file-input" type="file" hidden />
        <button id="file-button" class="primary">파일 선택</button>
        <small>권장 20MB 이하 · 파일은 외부로 업로드되지 않습니다</small>
      </div>

      <div id="sender" class="sender hidden">
        <div class="qr-stage">
          <canvas id="qr-canvas" aria-label="전송 중인 QR 코드"></canvas>
          <div id="send-complete" class="complete-overlay hidden"><span>✓</span><b>1회 전송 완료</b><small>필요하면 계속 반복합니다</small></div>
        </div>
        <div class="file-row"><span class="file-icon">▦</span><span><b id="send-name"></b><small id="send-meta"></small></span></div>
        <div class="progress-track"><i id="send-progress"></i></div>
        <div class="status-line"><span id="send-status">준비 중…</span><b id="send-percent">0%</b></div>
        <div class="speed-control">
          <div class="speed-heading"><label for="speed-range">전송 속도</label><b id="speed-value">6 FPS · 안정적</b></div>
          <input id="speed-range" type="range" min="2" max="12" value="6" step="1" />
          <div class="speed-labels"><span>느리게</span><span>빠르게</span></div>
        </div>
        <div class="sender-controls">
          <button id="pause-button" class="secondary">일시정지</button>
          <button id="change-button" class="text-button">다른 파일</button>
        </div>
        <p class="hint">받는 기기의 카메라에 QR 전체가 보이도록 고정하세요.</p>
      </div>
    </section>

    <section id="receive-panel" class="panel">
      <div id="camera-start" class="camera-start">
        <div class="camera-icon">◎</div>
        <h2>카메라를 준비하세요</h2>
        <p>송신 화면의 움직이는 QR을 비추면<br />파일 조각을 자동으로 모읍니다.</p>
        <button id="camera-button" class="primary">카메라 시작</button>
        <small>촬영 영상은 기기 밖으로 전송되지 않습니다</small>
      </div>

      <div id="receiver" class="receiver hidden">
        <div class="viewfinder">
          <video id="camera" playsinline muted></video>
          <canvas id="scan-canvas" hidden></canvas>
          <div class="corners"><i></i><i></i><i></i><i></i></div>
          <span id="scan-pill" class="scan-pill">QR을 찾는 중</span>
        </div>
        <div id="receive-file" class="file-row muted"><span class="file-icon">↓</span><span><b id="receive-name">파일을 기다리는 중</b><small id="receive-meta">QR을 화면 안에 맞춰주세요</small></span></div>
        <div class="progress-track"><i id="receive-progress"></i></div>
        <div class="status-line"><span id="receive-status">수신 대기</span><b id="receive-percent">0%</b></div>
        <button id="save-button" class="primary hidden">파일 저장</button>
        <button id="reset-button" class="text-button hidden">새 파일 받기</button>
      </div>
    </section>

    <footer><span>모든 처리는 이 기기 안에서 이루어집니다.</span><span>QR Air · Local-first transfer</span></footer>
  </main>
`;

const $ = (selector) => document.querySelector(selector);
const state = {
  mode: "send",
  sendTimer: null,
  sendPaused: false,
  sendFrames: [],
  sendIndex: 0,
  sendFps: 6,
  stream: null,
  scanning: false,
  receiveId: null,
  receiveChunks: new Map(),
  receiveMeta: null,
  receivedBlob: null,
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

function selectMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-tab").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#send-panel").classList.toggle("active", mode === "send");
  $("#receive-panel").classList.toggle("active", mode === "receive");
  if (mode === "send") stopCamera();
  if (mode === "receive" && state.sendFrames.length) {
    state.sendPaused = true;
    $("#pause-button").textContent = "계속 보내기";
  }
}

document.querySelectorAll(".mode-tab").forEach((button) => button.addEventListener("click", () => selectMode(button.dataset.mode)));
$("#file-button").addEventListener("click", (event) => { event.stopPropagation(); $("#file-input").click(); });
$("#drop-zone").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (event) => event.target.files[0] && prepareFile(event.target.files[0]));
$("#drop-zone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("dragging"); });
$("#drop-zone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
$("#drop-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  event.currentTarget.classList.remove("dragging");
  if (event.dataTransfer.files[0]) prepareFile(event.dataTransfer.files[0]);
});

async function prepareFile(file) {
  if (file.size > 20 * 1024 * 1024) {
    alert("현재 버전은 20MB 이하 파일을 권장합니다.");
    return;
  }
  clearInterval(state.sendTimer);
  $("#drop-zone").classList.add("hidden");
  $("#sender").classList.remove("hidden");
  $("#send-name").textContent = file.name;
  $("#send-meta").textContent = `${formatBytes(file.size)} · 암호화 해시 계산 중`;
  $("#send-status").textContent = "파일 준비 중…";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 520;
  const total = Math.max(1, Math.ceil(bytes.length / chunkSize));
  const meta = {
    id: makeSessionId(), total, size: bytes.length, name: file.name,
    type: file.type || "application/octet-stream", hash: await sha256(bytes),
  };
  state.sendFrames = Array.from({ length: total }, (_, index) => createFrame(meta, index, bytes.subarray(index * chunkSize, (index + 1) * chunkSize)));
  state.sendIndex = 0;
  state.sendPaused = false;
  $("#pause-button").textContent = "일시정지";
  $("#send-meta").textContent = `${formatBytes(file.size)} · ${total}개 QR 조각`;
  $("#send-complete").classList.add("hidden");
  await renderNextFrame();
  startSendTimer();
}

function startSendTimer() {
  clearInterval(state.sendTimer);
  state.sendTimer = setInterval(renderNextFrame, Math.round(1000 / state.sendFps));
}

async function renderNextFrame() {
  if (state.sendPaused || !state.sendFrames.length) return;
  const index = state.sendIndex;
  await QRCode.toCanvas($("#qr-canvas"), state.sendFrames[index], {
    errorCorrectionLevel: "L", margin: 2, width: 520,
    color: { dark: "#11110f", light: "#ffffff" },
  });
  const percent = Math.round(((index + 1) / state.sendFrames.length) * 100);
  $("#send-progress").style.width = `${percent}%`;
  $("#send-percent").textContent = `${percent}%`;
  $("#send-status").textContent = `QR ${index + 1} / ${state.sendFrames.length}`;
  state.sendIndex = (index + 1) % state.sendFrames.length;
  if (state.sendIndex === 0) {
    $("#send-complete").classList.remove("hidden");
    setTimeout(() => $("#send-complete").classList.add("hidden"), 800);
  }
}

$("#pause-button").addEventListener("click", () => {
  state.sendPaused = !state.sendPaused;
  $("#pause-button").textContent = state.sendPaused ? "계속 보내기" : "일시정지";
  $("#send-status").textContent = state.sendPaused ? "전송 일시정지" : "전송 재개";
});
$("#speed-range").addEventListener("input", (event) => {
  state.sendFps = Number(event.target.value);
  const description = state.sendFps <= 4 ? "매우 안정적" : state.sendFps <= 7 ? "안정적" : state.sendFps <= 9 ? "빠름" : "실험적";
  $("#speed-value").textContent = `${state.sendFps} FPS · ${description}`;
  if (state.sendFrames.length) startSendTimer();
});
$("#change-button").addEventListener("click", resetSender);

function resetSender() {
  clearInterval(state.sendTimer);
  state.sendFrames = [];
  $("#file-input").value = "";
  $("#sender").classList.add("hidden");
  $("#drop-zone").classList.remove("hidden");
}

$("#camera-button").addEventListener("click", startCamera);

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("카메라를 열 수 없습니다. iPhone에서는 HTTPS로 접속했는지 확인해주세요.");
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const video = $("#camera");
    video.srcObject = state.stream;
    await video.play();
    $("#camera-start").classList.add("hidden");
    $("#receiver").classList.remove("hidden");
    state.scanning = true;
    requestAnimationFrame(scanFrame);
  } catch (error) {
    alert(`카메라를 시작하지 못했습니다. Safari 설정에서 카메라 권한을 확인해주세요.\n\n${error.message}`);
  }
}

function stopCamera() {
  state.scanning = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  $("#camera").srcObject = null;
  $("#camera-start").classList.remove("hidden");
  $("#receiver").classList.add("hidden");
}

function scanFrame() {
  if (!state.scanning) return;
  const video = $("#camera");
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    const canvas = $("#scan-canvas");
    const maxWidth = 960;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
    if (code) acceptFrame(code.data);
  }
  setTimeout(() => requestAnimationFrame(scanFrame), 55);
}

async function acceptFrame(raw) {
  const frame = parseFrame(raw);
  if (!frame) return;
  if (state.receiveId && frame.id !== state.receiveId) return;
  if (!state.receiveId) {
    state.receiveId = frame.id;
    state.receiveMeta = { total: frame.t, size: frame.s, name: frame.n, type: frame.m, hash: frame.h };
    $("#receive-name").textContent = frame.n;
    $("#receive-meta").textContent = `${formatBytes(frame.s)} · ${frame.t}개 QR 조각`;
    $("#receive-file").classList.remove("muted");
  }
  if (!state.receiveChunks.has(frame.i)) state.receiveChunks.set(frame.i, base64ToBytes(frame.d));
  const count = state.receiveChunks.size;
  const percent = Math.round((count / state.receiveMeta.total) * 100);
  $("#receive-progress").style.width = `${percent}%`;
  $("#receive-percent").textContent = `${percent}%`;
  $("#receive-status").textContent = `${count} / ${state.receiveMeta.total} 조각 수신`;
  $("#scan-pill").textContent = "QR 수신 중";
  $("#scan-pill").classList.add("found");
  clearTimeout(acceptFrame.pillTimer);
  acceptFrame.pillTimer = setTimeout(() => {
    $("#scan-pill").textContent = "QR을 찾는 중";
    $("#scan-pill").classList.remove("found");
  }, 500);
  if (count === state.receiveMeta.total && !state.receivedBlob) await finishReceive();
}

async function finishReceive() {
  state.scanning = false;
  $("#receive-status").textContent = "파일 무결성 확인 중…";
  try {
    const bytes = assembleFrames(state.receiveChunks, state.receiveMeta.total, state.receiveMeta.size);
    const digest = await sha256(bytes);
    if (digest !== state.receiveMeta.hash) throw new Error("SHA-256 해시가 일치하지 않습니다.");
    state.receivedBlob = new Blob([bytes], { type: state.receiveMeta.type });
    $("#receive-status").textContent = "파일 수신 완료";
    $("#scan-pill").textContent = "수신 완료 ✓";
    $("#scan-pill").classList.add("found");
    $("#save-button").classList.remove("hidden");
    $("#reset-button").classList.remove("hidden");
    if (navigator.vibrate) navigator.vibrate([80, 40, 120]);
  } catch (error) {
    $("#receive-status").textContent = `복원 실패: ${error.message}`;
    state.scanning = true;
    requestAnimationFrame(scanFrame);
  }
}

$("#save-button").addEventListener("click", async () => {
  const file = new File([state.receivedBlob], state.receiveMeta.name, { type: state.receiveMeta.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: state.receiveMeta.name }); return; } catch (error) { if (error.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(state.receivedBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.receiveMeta.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("#reset-button").addEventListener("click", () => {
  state.receiveId = null;
  state.receiveChunks = new Map();
  state.receiveMeta = null;
  state.receivedBlob = null;
  $("#receive-name").textContent = "파일을 기다리는 중";
  $("#receive-meta").textContent = "QR을 화면 안에 맞춰주세요";
  $("#receive-file").classList.add("muted");
  $("#receive-progress").style.width = "0%";
  $("#receive-percent").textContent = "0%";
  $("#receive-status").textContent = "수신 대기";
  $("#save-button").classList.add("hidden");
  $("#reset-button").classList.add("hidden");
  state.scanning = true;
  requestAnimationFrame(scanFrame);
});

window.addEventListener("beforeunload", stopCamera);
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js");
