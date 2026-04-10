/**
 * 📸 Photo Booth — Epson TM-m30II Thermal Printer App
 * 
 * Features:
 * - Camera capture with filters
 * - Photo strip compositor (576px for 80mm paper)
 * - Direct print via Epson ePOS XML API (WiFi)
 * - Gallery with upload support
 * - Thermal printer simulator
 */

import './style.css';

// =============================================
// STATE
// =============================================
const S = {
  screen: 'home',       // home | camera | preview | gallery | setup
  photos: [],            // captured photo data URLs (max 4)
  maxPhotos: 4,
  currentStrip: null,    // composed strip data URL
  stripTitle: 'Photo Booth',
  stripStyle: 'white',   // white | vintage | dark | pink
  filter: 'none',
  facing: 'user',        // user | environment
  gallery: [],
  // Printer
  printerIP: localStorage.getItem('epson_printer_ip') || '',
  printerConnected: false,
  // Camera
  stream: null,
  autoTimer: null,
};

// =============================================
// HELPERS
// =============================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 2500);
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// =============================================
// GALLERY PERSISTENCE
// =============================================
function loadGallery() {
  try {
    const data = localStorage.getItem('pb_gallery');
    S.gallery = data ? JSON.parse(data) : [];
  } catch { S.gallery = []; }
}

function saveGallery() {
  try {
    // Keep only last 20 items to avoid localStorage overflow
    const trimmed = S.gallery.slice(0, 20);
    localStorage.setItem('pb_gallery', JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Gallery save failed:', e);
  }
}

// =============================================
// CAMERA
// =============================================
async function startCamera() {
  try {
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); }
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: S.facing, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    const video = $('#viewfinder');
    if (video) {
      video.srcObject = S.stream;
      video.setAttribute('playsinline', 'true');
      video.play();
    }
  } catch (err) {
    toast('Không thể mở camera: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
  if (S.autoTimer) { clearTimeout(S.autoTimer); S.autoTimer = null; }
}

function flipCamera() {
  S.facing = S.facing === 'user' ? 'environment' : 'user';
  startCamera();
}

function getFilterCSS(filter) {
  const filters = {
    none: 'none', bw: 'grayscale(1)', sepia: 'sepia(0.8)',
    vintage: 'sepia(0.3) contrast(1.1) brightness(1.05)',
    cool: 'saturate(1.3) hue-rotate(10deg) brightness(1.05)',
    warm: 'saturate(1.2) sepia(0.15) brightness(1.05)',
  };
  return filters[filter] || 'none';
}

function capturePhoto() {
  const video = $('#viewfinder');
  if (!video || S.photos.length >= S.maxPhotos) return;

  // Flash effect
  const wrap = $('.viewfinder-wrap');
  if (wrap) {
    const flash = document.createElement('div');
    flash.className = 'flash-overlay';
    wrap.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
  }

  // Capture
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');

  // Mirror front camera
  if (S.facing === 'user') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  // Apply filter
  ctx.filter = getFilterCSS(S.filter);
  ctx.drawImage(video, 0, 0);

  S.photos.push(canvas.toDataURL('image/jpeg', 0.92));
  renderCameraUI();

  if (S.photos.length >= S.maxPhotos) {
    stopCamera();
    show('preview');
  }
}

async function startAutoCapture() {
  if (S.photos.length >= S.maxPhotos) return;

  for (let remaining = 3; remaining > 0; remaining--) {
    showCountdown(remaining);
    await wait(1000);
  }
  showCountdown(null);
  capturePhoto();

  if (S.photos.length < S.maxPhotos) {
    S.autoTimer = setTimeout(() => startAutoCapture(), 800);
  }
}

function showCountdown(n) {
  const overlay = $('.viewfinder-overlay');
  if (!overlay) return;
  overlay.innerHTML = n ? `<div class="countdown-display">${n}</div>` : '';
}

function renderCameraUI() {
  const thumbs = $('.photo-thumbs');
  if (!thumbs) return;
  thumbs.innerHTML = Array.from({ length: S.maxPhotos }, (_, i) => {
    const photo = S.photos[i];
    return `<div class="photo-thumb ${photo ? 'filled' : ''}">
      ${photo ? `<img src="${photo}" alt="">` : ''}
    </div>`;
  }).join('');

  const counter = $('.camera-counter');
  if (counter) counter.textContent = `${S.photos.length} / ${S.maxPhotos}`;
}

// =============================================
// PHOTO STRIP COMPOSITOR
// =============================================
async function composeStrip() {
  if (S.photos.length === 0) return;
  if (S.currentStrip && S.photos.length === S.maxPhotos) return; // Already composed

  const WIDTH = 576; // 72mm printable area at 203 DPI
  const PHOTO_GAP = 12;
  const PADDING = 16;
  const PHOTO_W = WIDTH - PADDING * 2;
  const PHOTO_H = Math.round(PHOTO_W * 3 / 4); // 4:3 ratio
  const FOOTER_H = 60;

  const totalH = PADDING + (PHOTO_H + PHOTO_GAP) * S.photos.length - PHOTO_GAP + FOOTER_H + PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // Background
  const bgColors = { white: '#ffffff', vintage: '#f5f0e8', dark: '#1a1a1a', pink: '#fce4ec' };
  ctx.fillStyle = bgColors[S.stripStyle] || '#ffffff';
  ctx.fillRect(0, 0, WIDTH, totalH);

  // Draw photos with cover-fit cropping
  for (let i = 0; i < S.photos.length; i++) {
    const img = await loadImage(S.photos[i]);
    const y = PADDING + i * (PHOTO_H + PHOTO_GAP);

    // Cover-fit crop
    const srcAspect = img.width / img.height;
    const destAspect = PHOTO_W / PHOTO_H;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcAspect > destAspect) {
      sw = img.height * destAspect;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / destAspect;
      sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, PADDING, y, PHOTO_W, PHOTO_H);
  }

  // Footer text
  const textColor = S.stripStyle === 'dark' ? '#e0e0e0' : '#333333';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Inter, sans-serif';
  const footerY = totalH - PADDING - 12;
  ctx.fillText(S.stripTitle, WIDTH / 2, footerY);
  ctx.font = '14px Inter, sans-serif';
  ctx.fillStyle = S.stripStyle === 'dark' ? '#888' : '#999';
  ctx.fillText(formatDate(new Date()), WIDTH / 2, footerY + 20);

  S.currentStrip = canvas.toDataURL('image/jpeg', 0.95);
}

// =============================================
// EPSON ePOS PRINT (WiFi/IP)
// =============================================
async function testPrinterConnection(ip) {
  try {
    const url = `http://${ip}:8008/cgi-bin/epos/service.cgi?devid=local_printer&timeout=5000`;
    const testXml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
    </epos-print>
  </s:Body>
</s:Envelope>`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
      body: testXml,
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function printViaEpson(imageDataUrl) {
  const ip = S.printerIP;
  if (!ip) { show('setup'); return; }

  toast('Đang chuẩn bị in...', 'info');

  try {
    const img = await loadImage(imageDataUrl || S.currentStrip);
    const canvas = document.createElement('canvas');
    canvas.width = 576;
    canvas.height = Math.round((img.height / img.width) * 576);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rasterBase64 = toMonoRaster(imageData, canvas.width, canvas.height);

    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      <image width="${canvas.width}" height="${canvas.height}" color="color_1" mode="mono">${rasterBase64}</image>
      <feed unit="30"/>
      <cut type="feed"/>
    </epos-print>
  </s:Body>
</s:Envelope>`;

    toast('Đang gửi đến máy in...', 'info');
    const url = `http://${ip}:8008/cgi-bin/epos/service.cgi?devid=local_printer&timeout=30000`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
      body: xmlBody,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const text = await response.text();
      if (text.includes('success="true"') || text.includes('code=""')) {
        toast('✅ In thành công!', 'success');
        S.printerConnected = true;
      } else {
        toast('Máy in phản hồi lỗi. Kiểm tra giấy.', 'error');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    S.printerConnected = false;
    if (err.name === 'TimeoutError') {
      toast('Hết thời gian chờ. Kiểm tra máy in.', 'error');
    } else {
      toast('Không kết nối được: ' + err.message, 'error');
    }
  }
}

/**
 * Convert ImageData to monochrome raster (base64) with Floyd-Steinberg dithering
 */
function toMonoRaster(imageData, w, h) {
  const px = imageData.data;
  const gray = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * px[i*4] + 0.587 * px[i*4+1] + 0.114 * px[i*4+2];
  }

  // Floyd-Steinberg dithering
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const val = old < 128 ? 0 : 255;
      gray[i] = val;
      const err = old - val;
      if (x + 1 < w) gray[i + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x > 0) gray[(y+1)*w + x-1] += err * 3 / 16;
        gray[(y+1)*w + x] += err * 5 / 16;
        if (x + 1 < w) gray[(y+1)*w + x+1] += err / 16;
      }
    }
  }

  const bpr = Math.ceil(w / 8);
  const bytes = new Uint8Array(bpr * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] < 128) {
        bytes[y * bpr + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// =============================================
// PRINTER SIMULATOR
// =============================================
async function openSimulator() {
  if (!S.currentStrip) { toast('Chưa có ảnh', 'error'); return; }
  toast('Đang render giả lập...', 'info');

  const img = await loadImage(S.currentStrip);
  const canvas = document.createElement('canvas');
  canvas.width = 576;
  canvas.height = Math.round((img.height / img.width) * 576);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imageData.data;
  const w = canvas.width, h = canvas.height;
  const gray = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) gray[i] = 0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y*w+x; const o = gray[i]; const v = o<128?0:255; gray[i]=v; const e=o-v;
    if(x+1<w) gray[i+1]+=e*7/16;
    if(y+1<h){if(x>0)gray[(y+1)*w+x-1]+=e*3/16;gray[(y+1)*w+x]+=e*5/16;if(x+1<w)gray[(y+1)*w+x+1]+=e/16;}
  }
  for (let i=0;i<w*h;i++){const v=gray[i]<128?0:255;px[i*4]=v;px[i*4+1]=v;px[i*4+2]=v;px[i*4+3]=255;}
  ctx.putImageData(imageData, 0, 0);
  const thermalUrl = canvas.toDataURL('image/png');

  const win = window.open('', '_blank');
  if (!win) { toast('Popup bị chặn!', 'error'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🧪 Giả lập Epson TM-m30II</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px}
h1{font-size:18px;font-weight:700;margin-bottom:4px}.sub{font-size:13px;color:#888;margin-bottom:20px}
.printer{background:#2d2d3f;border-radius:20px 20px 8px 8px;padding:20px 16px 8px;width:100%;max-width:380px;box-shadow:0 8px 40px rgba(0,0,0,.4)}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.brand{font-size:12px;font-weight:700;color:#6366f1;letter-spacing:2px;text-transform:uppercase}.model{font-size:11px;color:#555}
.led{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e;animation:blink 2s infinite}@keyframes blink{50%{opacity:.4}}
.slot{background:#111;border-radius:4px;padding:4px;overflow:hidden}
.receipt{background:#f5f0e8;padding:8px;animation:slide 1.5s ease-out forwards;transform:translateY(-100%);position:relative}
.receipt::after{content:'';position:absolute;bottom:-6px;left:0;right:0;height:6px;background:linear-gradient(135deg,#f5f0e8 33.33%,transparent 33.33%) -6px 0,linear-gradient(225deg,#f5f0e8 33.33%,transparent 33.33%) -6px 0;background-size:12px 6px}
@keyframes slide{from{transform:translateY(-100%);opacity:0}20%{opacity:1}to{transform:translateY(0);opacity:1}}
.receipt img{width:100%;display:block;image-rendering:pixelated}
.info{display:flex;justify-content:space-between;margin-top:16px;width:100%;max-width:380px;font-size:12px;color:#666}
.specs{margin-top:20px;width:100%;max-width:380px;background:#2d2d3f;border-radius:12px;padding:16px}
.specs h3{font-size:14px;margin-bottom:8px;color:#a855f7}.row{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #3a3a4a}.row:last-child{border:none}.lbl{color:#888}.val{font-weight:600}
.acts{margin-top:20px;display:flex;gap:10px}
button{padding:12px 24px;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:transform .1s}button:active{transform:scale(.96)}
.save{background:#6366f1;color:#fff}.close{background:#3a3a4a;color:#ccc}
</style></head><body>
<h1>🧪 Giả lập Epson TM-m30II</h1><p class="sub">Kết quả in trên giấy nhiệt 80mm</p>
<div class="printer"><div class="top"><div><div class="brand">EPSON</div><div class="model">TM-m30II · 80mm</div></div><div class="led"></div></div>
<div class="slot"><div class="receipt"><img src="${thermalUrl}" alt="Preview"></div></div></div>
<div class="info"><span>576 × ${h} dots</span><span>203 DPI</span><span>Mono</span></div>
<div class="specs"><h3>📋 Thông số</h3>
<div class="row"><span class="lbl">Khổ giấy</span><span class="val">80mm</span></div>
<div class="row"><span class="lbl">Độ phân giải</span><span class="val">576×${h}</span></div>
<div class="row"><span class="lbl">DPI</span><span class="val">203</span></div>
<div class="row"><span class="lbl">Màu</span><span class="val">Mono 1-bit</span></div>
<div class="row"><span class="lbl">Dithering</span><span class="val">Floyd-Steinberg</span></div>
<div class="row"><span class="lbl">Dữ liệu</span><span class="val">${Math.round(576*h/8/1024)} KB</span></div></div>
<div class="acts"><button class="save" onclick="const a=document.createElement('a');a.href='${thermalUrl}';a.download='thermal.png';a.click()">💾 Lưu</button>
<button class="close" onclick="window.close()">Đóng</button></div>
</body></html>`);
  win.document.close();
}

// =============================================
// FILE UPLOAD
// =============================================
function triggerUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => handleUpload(input.files);
  input.click();
}

async function handleUpload(files) {
  if (!files || files.length === 0) return;
  toast(`Đang tải ${files.length} ảnh...`, 'info');

  let count = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      S.gallery.unshift({
        id: 'up_' + Date.now() + '_' + count,
        dataUrl,
        date: new Date().toISOString(),
        title: file.name.replace(/\.[^/.]+$/, ''),
      });
      count++;
    } catch (e) { console.error(e); }
  }
  if (count > 0) {
    saveGallery();
    toast(`✅ Đã tải ${count} ảnh`, 'success');
    show('gallery');
  }
}

// =============================================
// ACTIONS
// =============================================
function saveStripToGallery() {
  if (!S.currentStrip) return;
  S.gallery.unshift({
    id: 'strip_' + Date.now(),
    dataUrl: S.currentStrip,
    date: new Date().toISOString(),
    title: S.stripTitle,
  });
  saveGallery();
  toast('✅ Đã lưu vào Gallery', 'success');
}

async function downloadStrip() {
  if (!S.currentStrip) return;
  const a = document.createElement('a');
  a.href = S.currentStrip;
  a.download = `photobooth_${Date.now()}.jpg`;
  a.click();
  toast('✅ Đã tải xuống', 'success');
}

async function shareStrip() {
  if (!S.currentStrip) return;
  try {
    const blob = await (await fetch(S.currentStrip)).blob();
    const file = new File([blob], 'photobooth.jpg', { type: 'image/jpeg' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: S.stripTitle });
      toast('✅ Đã chia sẻ', 'success');
    } else {
      downloadStrip();
    }
  } catch (e) {
    if (e.name !== 'AbortError') downloadStrip();
  }
}

async function savePrinterIP() {
  const input = $('#ip-input');
  const ip = input?.value?.trim();
  if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    toast('IP không hợp lệ', 'error');
    return;
  }

  toast('Đang kiểm tra kết nối...', 'info');
  S.printerIP = ip;
  localStorage.setItem('epson_printer_ip', ip);

  const ok = await testPrinterConnection(ip);
  S.printerConnected = ok;
  if (ok) {
    toast('✅ Kết nối thành công!', 'success');
    show('home');
  } else {
    toast('⚠️ Đã lưu IP. Máy in chưa phản hồi — kiểm tra WiFi.', 'error');
    show('home');
  }
}

// =============================================
// UI RENDERING
// =============================================
function show(screen) {
  S.screen = screen;
  if (screen !== 'camera') stopCamera();
  render();
  if (screen === 'camera') startCamera();
}

function render() {
  const app = document.getElementById('app');
  const screens = {
    home: renderHome,
    camera: renderCamera,
    preview: renderPreview,
    gallery: renderGallery,
    setup: renderSetup,
    print: renderPrintOptions,
  };
  app.innerHTML = (screens[S.screen] || renderHome)();

  // Post-render hooks
  if (S.screen === 'camera') {
    setTimeout(() => renderCameraUI(), 50);
  }
  if (S.screen === 'preview') {
    composeStrip().then(() => {
      const img = $('#strip-img');
      if (img && S.currentStrip) img.src = S.currentStrip;
    });
  }
}

// ----- HOME -----
function renderHome() {
  const connected = S.printerConnected;
  const hasIP = !!S.printerIP;
  return `
  <div class="screen active home-screen" id="screen-home">
    <div class="printer-status ${connected ? 'connected' : 'disconnected'}" onclick="W.show('setup')">
      <div class="dot"></div>
      ${connected ? `Máy in: ${S.printerIP}` : (hasIP ? `⚠ ${S.printerIP} — chưa kết nối` : '🔌 Chưa cài đặt máy in')}
    </div>
    <div class="home-logo">📸</div>
    <div class="home-title">Photo Booth</div>
    <div class="home-subtitle">Chụp · In · Chia sẻ</div>
    <div class="home-actions">
      <button class="btn btn-accent btn-block" onclick="W.startSession()">
        <span class="icon">📷</span> Bắt đầu chụp
      </button>
      <button class="btn btn-ghost btn-block" onclick="W.show('gallery')">
        <span class="icon">🖼️</span> Gallery ${S.gallery.length > 0 ? `(${S.gallery.length})` : ''}
      </button>
      <button class="btn btn-ghost btn-block" onclick="W.triggerUpload()">
        <span class="icon">📁</span> Tải ảnh lên & In
      </button>
      <button class="btn btn-ghost btn-block btn-sm" onclick="W.show('setup')">
        <span class="icon">⚙️</span> Cài đặt máy in
      </button>
    </div>
  </div>`;
}

// ----- CAMERA -----
function renderCamera() {
  return `
  <div class="screen active camera-screen" id="screen-camera">
    <div class="camera-header">
      <button class="btn btn-sm btn-ghost" onclick="W.cancelSession()" style="color:white;border-color:rgba(255,255,255,.3)">Hủy</button>
      <div class="camera-counter">${S.photos.length} / ${S.maxPhotos}</div>
      <button class="cam-side-btn" onclick="W.flipCamera()">🔄</button>
    </div>

    <div class="viewfinder-wrap">
      <video id="viewfinder" class="viewfinder" autoplay playsinline muted
             style="filter:${getFilterCSS(S.filter)}"></video>
      <div class="viewfinder-overlay"></div>
    </div>

    <div class="camera-controls">
      <div class="filter-bar">
        ${['none','bw','sepia','vintage','cool','warm'].map(f =>
          `<div class="filter-chip ${S.filter===f?'active':''}" onclick="W.setFilter('${f}')">${
            {none:'Gốc',bw:'B&W',sepia:'Sepia',vintage:'Vintage',cool:'Cool',warm:'Warm'}[f]
          }</div>`
        ).join('')}
      </div>

      <div class="capture-row">
        <button class="cam-side-btn" onclick="W.startAutoCapture()">⏱</button>
        <button class="capture-btn" onclick="W.capturePhoto()" id="capture-btn"></button>
        <div style="width:44px"></div>
      </div>

      <div class="photo-thumbs">
        ${Array.from({length: S.maxPhotos}, () => '<div class="photo-thumb"></div>').join('')}
      </div>
    </div>
  </div>`;
}

// ----- PREVIEW -----
function renderPreview() {
  return `
  <div class="screen active preview-screen" id="screen-preview">
    <div class="preview-header">
      <button class="btn btn-sm btn-ghost" onclick="W.retake()">
        <span class="icon">↩</span> Chụp lại
      </button>
      <div class="preview-title">Kết quả</div>
      <button class="btn btn-sm btn-ghost" onclick="W.show('home')">✕</button>
    </div>

    <div class="strip-container">
      <div class="strip-preview">
        <img id="strip-img" src="" alt="Photo Strip">
      </div>
    </div>

    <div class="customize-section">
      <div>
        <div class="section-label">🎨 Kiểu khung</div>
        <div class="style-chips">
          ${[
            {id:'white',label:'Trắng',bg:'#fff',c:'#333'},
            {id:'vintage',label:'Vintage',bg:'#f5f0e8',c:'#5a4a3a'},
            {id:'dark',label:'Tối',bg:'#1a1a1a',c:'#aaa'},
            {id:'pink',label:'Hồng',bg:'#fce4ec',c:'#c2185b'},
          ].map(s => `
            <div class="style-chip ${S.stripStyle===s.id?'active':''}"
                 onclick="W.setStyle('${s.id}')" title="${s.label}"
                 style="background:${s.bg};color:${s.c}">
              <div class="mini">
                <div class="mini-bar"></div><div class="mini-bar"></div><div class="mini-bar"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <div class="section-label">✏️ Tiêu đề</div>
        <input class="title-input" id="title-input" value="${S.stripTitle}"
               placeholder="Nhập tiêu đề..." oninput="W.setTitle(this.value)">
      </div>
    </div>

    <div class="action-row">
      <button class="btn btn-accent btn-block" onclick="W.show('print')">
        <span class="icon">🖨️</span> In ảnh
      </button>
    </div>
    <div class="action-row">
      <button class="btn btn-ghost" onclick="W.downloadStrip()">⬇ Tải</button>
      <button class="btn btn-ghost" onclick="W.saveStripToGallery()">💾 Lưu</button>
      <button class="btn btn-ghost" onclick="W.shareStrip()">↗ Chia sẻ</button>
    </div>
  </div>`;
}

// ----- PRINT OPTIONS -----
function renderPrintOptions() {
  const hasIP = !!S.printerIP;
  const hasBT = !!navigator.bluetooth;

  return `
  <div class="screen active" id="screen-print">
    <div class="preview-header">
      <button class="btn btn-sm btn-ghost" onclick="W.show('preview')">← Quay lại</button>
      <div class="preview-title">Chọn cách in</div>
      <div style="width:60px"></div>
    </div>

    <div class="strip-container">
      <div class="strip-preview" style="max-width:180px">
        <img src="${S.currentStrip || ''}" alt="">
      </div>
    </div>

    <div class="print-cards">
      <div class="print-card" onclick="W.doPrintEpson()">
        <div class="print-card-icon wifi">🌐</div>
        <div class="print-card-info">
          <h3>In qua WiFi (ePOS)</h3>
          <p>${hasIP ? `<b>${S.printerIP}</b> — nhấn để in ngay!` : 'Cài đặt IP máy in trước'}</p>
        </div>
      </div>

      <div class="print-card" onclick="W.openSimulator()">
        <div class="print-card-icon sim">🧪</div>
        <div class="print-card-info">
          <h3>Giả lập máy in</h3>
          <p>Xem trước kết quả in trên giấy nhiệt 80mm</p>
        </div>
      </div>

      <div class="print-card" onclick="W.shareStrip()">
        <div class="print-card-icon save">📤</div>
        <div class="print-card-info">
          <h3>Lưu & Chia sẻ</h3>
          <p>Tải ảnh về hoặc chia sẻ qua app</p>
        </div>
      </div>

      <div class="print-card" onclick="W.printViaSystem()">
        <div class="print-card-icon sys">🖨️</div>
        <div class="print-card-info">
          <h3>In qua hệ thống</h3>
          <p>Mở hộp thoại in macOS/Windows</p>
        </div>
      </div>

      ${hasBT ? `
      <div class="print-card" onclick="W.printViaBluetooth()">
        <div class="print-card-icon bt">🔵</div>
        <div class="print-card-info">
          <h3>Bluetooth BLE (thử nghiệm)</h3>
          <p>Kết nối BLE trực tiếp — Chrome only</p>
        </div>
      </div>` : ''}
    </div>
  </div>`;
}

// ----- GALLERY -----
function renderGallery() {
  return `
  <div class="screen active gallery-screen" id="screen-gallery">
    <div class="gallery-header">
      <button class="btn btn-sm btn-ghost" onclick="W.show('home')">← Về</button>
      <div class="preview-title">Gallery</div>
      <button class="btn btn-sm btn-ghost" onclick="W.triggerUpload()">📁 Tải lên</button>
    </div>

    ${S.gallery.length === 0 ? `
      <div class="gallery-empty">
        <div class="icon">🖼️</div>
        <p>Chưa có ảnh nào</p>
        <button class="btn btn-accent mt-16" onclick="W.triggerUpload()">📁 Tải ảnh lên</button>
        <button class="btn btn-ghost mt-8" onclick="W.startSession()">📸 Hoặc chụp mới</button>
      </div>
    ` : `
      <div style="padding:8px 16px">
        <button class="btn btn-accent btn-block" onclick="W.triggerUpload()">📁 Tải thêm ảnh</button>
      </div>
      <div class="gallery-grid">
        ${S.gallery.map(g => `
          <div class="gallery-card" onclick="W.viewGalleryItem('${g.id}')">
            <img src="${g.dataUrl}" alt="${g.title}">
            <div class="gallery-card-footer">
              <div class="gallery-card-date">${formatDate(g.date)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  </div>`;
}

// ----- SETUP -----
function renderSetup() {
  return `
  <div class="screen active setup-screen" id="screen-setup">
    <div class="setup-icon">🖨️</div>
    <div class="setup-title">Cài đặt máy in</div>
    <div class="setup-desc">
      Kết nối TM-m30II qua WiFi để in tự động.<br>
      App sẽ tự cài đúng khổ giấy 80mm.
    </div>

    <input class="ip-input" id="ip-input" type="text"
           value="${S.printerIP}" placeholder="192.168.1.xxx"
           inputmode="decimal">

    <button class="btn btn-accent btn-block" onclick="W.savePrinterIP()">
      🔗 Kết nối & Lưu
    </button>

    <div class="setup-steps">
      <h3>📋 Hướng dẫn kết nối WiFi cho TM-m30II</h3>
      <div class="setup-step">
        <div class="setup-step-num">1</div>
        <div>Mở app <b>Epson TM Utility</b> trên iPhone</div>
      </div>
      <div class="setup-step">
        <div class="setup-step-num">2</div>
        <div>Nhấn <b>"Wi-Fi® Setup Wizard"</b></div>
      </div>
      <div class="setup-step">
        <div class="setup-step-num">3</div>
        <div>Chọn mạng WiFi cùng mạng với thiết bị</div>
      </div>
      <div class="setup-step">
        <div class="setup-step-num">4</div>
        <div>Sau khi kết nối, vào <b>"View Printer Status"</b> → tìm <b>IP Address</b></div>
      </div>
      <div class="setup-step">
        <div class="setup-step-num">5</div>
        <div>Nhập IP vào ô trên → nhấn <b>Kết nối</b></div>
      </div>
    </div>

    <button class="btn btn-ghost btn-block" onclick="W.show('home')">← Về trang chủ</button>
  </div>`;
}

// =============================================
// SYSTEM PRINT & BLUETOOTH
// =============================================
function printViaSystem() {
  if (!S.currentStrip) return;
  const win = window.open('', '_blank');
  if (!win) { toast('Popup bị chặn!', 'error'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>In</title>
<style>@page{size:80mm auto;margin:0}*{margin:0;padding:0;box-sizing:border-box}body{background:#f5f5f5;display:flex;flex-direction:column;align-items:center;padding:24px;font-family:-apple-system,sans-serif}
img{max-width:300px;width:100%;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.15)}.btn{margin-top:16px;padding:12px 24px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;background:#007AFF;color:#fff}
.hint{margin-top:12px;font-size:13px;color:#888;text-align:center;line-height:1.6}b{color:#333}
@media print{.no-print{display:none!important}body{background:#fff;padding:0}img{max-width:none;width:80mm;border-radius:0;box-shadow:none}}</style></head>
<body><img src="${S.currentStrip}"><button class="btn no-print" onclick="window.print()">🖨️ In</button>
<p class="hint no-print">Chọn <b>TM-m30II</b> · Khổ <b>80mm</b> · Tỷ lệ <b>100%</b></p></body></html>`);
  win.document.close();
}

async function printViaBluetooth() {
  if (!S.currentStrip || !navigator.bluetooth) {
    toast('Cần Chrome + Bluetooth', 'error'); return;
  }
  try {
    toast('Tìm máy in BLE...', 'info');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{namePrefix:'TM-m30'},{namePrefix:'EPSON'}],
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb','49535343-fe7d-4ae5-8fa9-9fafd205e455'],
      acceptAllDevices: false,
    }).catch(() => navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb','49535343-fe7d-4ae5-8fa9-9fafd205e455'],
    }));

    toast(`Kết nối ${device.name}...`, 'info');
    const server = await device.gatt.connect();
    let writeChar = null;
    for (const svc of await server.getPrimaryServices()) {
      try {
        for (const ch of await svc.getCharacteristics()) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) { writeChar = ch; break; }
        }
        if (writeChar) break;
      } catch {}
    }
    if (!writeChar) { toast('Không tìm thấy kênh BLE', 'error'); server.disconnect(); return; }

    toast('Gửi ảnh...', 'info');
    const img = await loadImage(S.currentStrip);
    const c = document.createElement('canvas'); c.width=576; c.height=Math.round((img.height/img.width)*576);
    const cx = c.getContext('2d'); cx.drawImage(img,0,0,c.width,c.height);
    const data = buildEscPosRaster(cx.getImageData(0,0,c.width,c.height), c.width, c.height);

    for (let i=0; i<data.length; i+=200) {
      const chunk = data.slice(i, i+200);
      try {
        if (writeChar.properties.writeWithoutResponse) await writeChar.writeValueWithoutResponse(chunk);
        else await writeChar.writeValue(chunk);
      } catch { for (let j=0;j<chunk.length;j+=20){const m=chunk.slice(j,j+20);await writeChar.writeValueWithoutResponse(m);await wait(10);} }
      await wait(20);
    }
    toast('✅ In thành công!', 'success');
    server.disconnect();
  } catch (err) {
    if (err.name !== 'NotFoundError') toast('Lỗi BLE: '+err.message, 'error');
  }
}

function buildEscPosRaster(imageData, w, h) {
  const px = imageData.data;
  const gray = new Float32Array(w*h);
  for(let i=0;i<w*h;i++) gray[i]=0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){const i=y*w+x;const o=gray[i];const v=o<128?0:255;gray[i]=v;const e=o-v;if(x+1<w)gray[i+1]+=e*7/16;if(y+1<h){if(x>0)gray[(y+1)*w+x-1]+=e*3/16;gray[(y+1)*w+x]+=e*5/16;if(x+1<w)gray[(y+1)*w+x+1]+=e/16;}}
  const bpr=Math.ceil(w/8); const buf=[0x1B,0x40, 0x1D,0x76,0x30,0x00, bpr&0xFF,(bpr>>8)&0xFF, h&0xFF,(h>>8)&0xFF];
  for(let y=0;y<h;y++) for(let xb=0;xb<bpr;xb++){let b=0;for(let bit=0;bit<8;bit++){const x=xb*8+bit;if(x<w&&gray[y*w+x]<128)b|=(0x80>>bit);}buf.push(b);}
  buf.push(0x1B,0x64,0x05, 0x1D,0x56,0x41,0x03);
  return new Uint8Array(buf);
}

// =============================================
// GALLERY ITEM ACTIONS
// =============================================
function viewGalleryItem(id) {
  const item = S.gallery.find(g => g.id === id);
  if (!item) return;
  S.currentStrip = item.dataUrl;
  S.stripTitle = item.title || 'Photo Booth';
  show('print');
}

function deleteFromGallery(id) {
  S.gallery = S.gallery.filter(g => g.id !== id);
  saveGallery();
  show('gallery');
  toast('Đã xóa', 'info');
}

// =============================================
// SHORTCUT ACTIONS
// =============================================
function startSession() { S.photos = []; S.currentStrip = null; show('camera'); }
function cancelSession() { stopCamera(); S.photos = []; show('home'); }
function retake() { S.photos = []; S.currentStrip = null; show('camera'); }
function setFilter(f) {
  S.filter = f;
  const v = $('#viewfinder');
  if (v) v.style.filter = getFilterCSS(f);
  $$('.filter-chip').forEach(el => el.classList.remove('active'));
  event?.currentTarget?.classList.add('active');
}
function setStyle(id) {
  S.stripStyle = id;
  S.currentStrip = null;
  render();
}
function setTitle(val) {
  S.stripTitle = val;
  S.currentStrip = null;
}
function doPrintEpson() {
  if (!S.printerIP) { show('setup'); return; }
  printViaEpson();
}

// =============================================
// EXPOSE TO WINDOW (for inline onclick)
// =============================================
const W = {
  show, render, startSession, cancelSession, retake,
  capturePhoto, startAutoCapture, flipCamera, setFilter,
  setStyle, setTitle,
  downloadStrip, saveStripToGallery, shareStrip,
  doPrintEpson, openSimulator, printViaSystem, printViaBluetooth,
  savePrinterIP, triggerUpload,
  viewGalleryItem, deleteFromGallery,
};
window.W = W;

// =============================================
// INIT
// =============================================
loadGallery();

// Test printer connection on load
if (S.printerIP) {
  testPrinterConnection(S.printerIP).then(ok => {
    S.printerConnected = ok;
    render(); // Re-render with connection status
  });
}

render();
