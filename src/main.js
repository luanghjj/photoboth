import './style.css';

// ===== APP STATE =====
const S = {
  screen: 'home', // home | camera | preview | gallery | print
  photos: [],     // captured photos (data URLs) for current session
  maxPhotos: 4,
  filter: 'none', // none | bw | sepia | vintage | cool | warm
  stripStyle: 'white', // white | vintage | dark | pink
  stripTitle: 'Photo Booth',
  countdown: 3,
  gallery: [], // saved strips [{id, dataUrl, date, title}]
  currentStrip: null, // data URL of composited strip
  cameraFacing: 'user', // user | environment
  stream: null,
  printerIP: localStorage.getItem('epson_printer_ip') || '',
};

// ===== UTILITIES =====
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function show(id) { S.screen = id; render(); }

function toast(msg, type = 'info') {
  const c = $('#toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('exit'); setTimeout(() => el.remove(), 300); }, 3000);
}

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' · ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// ===== CAMERA =====
async function startCamera() {
  try {
    if (S.stream) {
      S.stream.getTracks().forEach(t => t.stop());
    }
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: S.cameraFacing,
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });
    const video = $('#camera-video');
    if (video) {
      video.srcObject = S.stream;
      video.play();
    }
  } catch (err) {
    toast('Không thể truy cập camera: ' + err.message, 'error');
  }
}

function stopCamera() {
  if (S.stream) {
    S.stream.getTracks().forEach(t => t.stop());
    S.stream = null;
  }
}

function flipCamera() {
  S.cameraFacing = S.cameraFacing === 'user' ? 'environment' : 'user';
  startCamera();
}

function getFilterCSS(filter) {
  const filters = {
    none: 'none',
    bw: 'grayscale(100%) contrast(1.1)',
    sepia: 'sepia(80%) contrast(1.05)',
    vintage: 'sepia(40%) contrast(1.1) brightness(0.95) saturate(0.8)',
    cool: 'saturate(0.8) hue-rotate(15deg) brightness(1.05)',
    warm: 'saturate(1.2) hue-rotate(-10deg) brightness(1.05) contrast(1.05)',
  };
  return filters[filter] || 'none';
}

function applyFilterToVideo() {
  const video = $('#camera-video');
  if (video) {
    video.style.filter = getFilterCSS(S.filter);
  }
}

// Take a single photo
function capturePhoto() {
  return new Promise((resolve) => {
    const video = $('#camera-video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    // Mirror for selfie cam
    if (S.cameraFacing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.filter = getFilterCSS(S.filter);
    ctx.drawImage(video, 0, 0);
    ctx.filter = 'none';

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    resolve(dataUrl);
  });
}

// Flash effect
function flash() {
  const overlay = $('#flash-overlay');
  if (overlay) {
    overlay.classList.add('active');
    setTimeout(() => overlay.classList.remove('active'), 150);
  }
}

// Countdown + capture sequence
async function startCaptureSequence() {
  const shutterBtn = $('#shutter-btn');
  if (shutterBtn) shutterBtn.disabled = true;

  for (let photoIdx = S.photos.length; photoIdx < S.maxPhotos; photoIdx++) {
    // Countdown
    for (let c = S.countdown; c > 0; c--) {
      showCountdown(c);
      await wait(1000);
    }
    hideCountdown();

    // Capture
    flash();
    const photo = await capturePhoto();
    S.photos.push(photo);

    // Vibrate
    if (navigator.vibrate) navigator.vibrate(50);

    // Update thumbnails
    renderThumbnails();
    updateCounter();

    if (photoIdx < S.maxPhotos - 1) {
      await wait(800); // Brief pause between photos
    }
  }

  if (shutterBtn) shutterBtn.disabled = false;

  // All photos taken — go to preview
  if (S.photos.length >= S.maxPhotos) {
    await wait(500);
    stopCamera();
    show('preview');
  }
}

// Single capture (tap for each photo)
async function captureSingle() {
  if (S.photos.length >= S.maxPhotos) return;

  const shutterBtn = $('#shutter-btn');
  if (shutterBtn) shutterBtn.disabled = true;

  // Countdown
  for (let c = S.countdown; c > 0; c--) {
    showCountdown(c);
    await wait(1000);
  }
  hideCountdown();

  // Capture
  flash();
  const photo = await capturePhoto();
  S.photos.push(photo);

  if (navigator.vibrate) navigator.vibrate(50);

  renderThumbnails();
  updateCounter();

  if (shutterBtn) shutterBtn.disabled = false;

  // All done?
  if (S.photos.length >= S.maxPhotos) {
    await wait(600);
    stopCamera();
    show('preview');
  }
}

function showCountdown(n) {
  const overlay = $('#countdown-overlay');
  const num = $('#countdown-number');
  if (overlay && num) {
    num.textContent = n;
    num.style.animation = 'none';
    void num.offsetWidth; // Reflow
    num.style.animation = 'countPulse .5s ease-out';
    overlay.classList.add('active');
  }
}

function hideCountdown() {
  const overlay = $('#countdown-overlay');
  if (overlay) overlay.classList.remove('active');
}

function updateCounter() {
  const counter = $('#photo-counter');
  if (counter) counter.textContent = `${S.photos.length} / ${S.maxPhotos}`;
}

function renderThumbnails() {
  const strip = $('#thumb-strip');
  if (!strip) return;
  strip.innerHTML = S.photos.map(p =>
    `<img src="${p}" class="thumb-img" alt="photo">`
  ).join('');
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ===== STRIP COMPOSITING =====
// Epson TM-m30II: 203 dpi, 80mm paper, 72mm printable = 576 dots width
async function composeStrip() {
  // Use 576px width to match exactly the TM-m30II printable area
  const PRINT_WIDTH = 576;
  const padding = 24;
  const gap = 12;
  const photoW = PRINT_WIDTH - (padding * 2); // 528px
  const photoH = Math.round(photoW * 0.75); // 4:3 ratio = 396px
  const footerH = 70;

  const totalH = padding + (S.photos.length * (photoH + gap)) - gap + footerH + padding;
  const totalW = PRINT_WIDTH;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  // Background
  const bgColors = {
    white: '#ffffff',
    vintage: '#f5f0e8',
    dark: '#1a1a1a',
    pink: '#fce4ec',
  };
  ctx.fillStyle = bgColors[S.stripStyle] || '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw photos with cover-fit cropping
  for (let i = 0; i < S.photos.length; i++) {
    const img = await loadImage(S.photos[i]);
    const y = padding + i * (photoH + gap);
    // Cover-fit: crop to fill the target rectangle
    const srcRatio = img.width / img.height;
    const dstRatio = photoW / photoH;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (srcRatio > dstRatio) {
      sw = img.height * dstRatio;
      sx = (img.width - sw) / 2;
    } else {
      sh = img.width / dstRatio;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, padding, y, photoW, photoH);
  }

  // Footer text
  const footerY = padding + S.photos.length * (photoH + gap) - gap + 16;
  const textColor = S.stripStyle === 'dark' ? '#f0f0f0' : '#1a1a1a';
  const dateColor = S.stripStyle === 'dark' ? '#666' : '#999';

  ctx.textAlign = 'center';
  ctx.fillStyle = textColor;
  ctx.font = 'bold 24px Georgia, serif';
  ctx.fillText(S.stripTitle || 'Photo Booth', totalW / 2, footerY + 26);

  ctx.fillStyle = dateColor;
  ctx.font = '12px sans-serif';
  ctx.fillText(formatDate(new Date()), totalW / 2, footerY + 44);

  S.currentStrip = canvas.toDataURL('image/jpeg', 0.92);
  return S.currentStrip;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ===== SAVE & GALLERY =====
function saveToGallery() {
  if (!S.currentStrip) return;
  const entry = {
    id: Date.now().toString(),
    dataUrl: S.currentStrip,
    date: new Date().toISOString(),
    title: S.stripTitle,
    photoCount: S.photos.length,
  };
  S.gallery.unshift(entry);
  try {
    localStorage.setItem('photobooth_gallery', JSON.stringify(S.gallery));
  } catch (e) {
    // Storage full — remove oldest
    if (S.gallery.length > 10) {
      S.gallery = S.gallery.slice(0, 10);
      localStorage.setItem('photobooth_gallery', JSON.stringify(S.gallery));
    }
  }
  toast('Đã lưu vào gallery! ✓', 'success');
}

function loadGallery() {
  try {
    const data = localStorage.getItem('photobooth_gallery');
    if (data) S.gallery = JSON.parse(data);
  } catch (e) {
    S.gallery = [];
  }
}

function deleteFromGallery(id) {
  S.gallery = S.gallery.filter(g => g.id !== id);
  localStorage.setItem('photobooth_gallery', JSON.stringify(S.gallery));
  render();
  toast('Đã xóa', 'info');
}

function downloadStrip() {
  if (!S.currentStrip) return;
  const a = document.createElement('a');
  a.href = S.currentStrip;
  a.download = `photobooth_${Date.now()}.jpg`;
  a.click();
  toast('Đang tải xuống...', 'info');
}

// ===== PRINT =====

/**
 * Detect if running on mobile
 */
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Method 1: macOS/Desktop System Print Dialog
 * On macOS, Bluetooth printers DO appear in the print dialog (unlike iOS)
 */
function printViaSystem() {
  if (!S.currentStrip) { toast('Chưa có ảnh để in', 'error'); return; }

  const win = window.open('', '_blank');
  if (!win) { toast('Popup bị chặn!', 'error'); return; }

  win.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>In Photo Strip</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #f5f5f5; display: flex; flex-direction: column; align-items: center; padding: 24px; font-family: -apple-system, sans-serif; }
  img#strip { max-width: 300px; width: 100%; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
  .actions { margin-top: 20px; display: flex; gap: 10px; }
  button { padding: 12px 24px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn-print { background: #007AFF; color: white; }
  .btn-close { background: #e5e5ea; color: #1c1c1e; }
  .hint { margin-top: 16px; font-size: 13px; color: #888; text-align: center; line-height: 1.6; max-width: 350px; }
  .hint b { color: #333; }
  @media print {
    .no-print { display: none !important; }
    body { background: white; padding: 0; }
    img#strip { max-width: none; width: 80mm; border-radius: 0; box-shadow: none; }
  }
</style>
</head><body>
  <img id="strip" src="${S.currentStrip}" alt="Photo Strip">
  <div class="actions no-print">
    <button class="btn-print" onclick="window.print()">🖨️ In</button>
    <button class="btn-close" onclick="window.close()">Đóng</button>
  </div>
  <p class="hint no-print">
    Chọn <b>TM-m30II</b> trong danh sách máy in.<br>
    Khổ giấy: <b>80mm</b> · Lề: <b>Không</b> · Tỷ lệ: <b>100%</b>
  </p>
</body></html>`);
  win.document.close();
}

/**
 * Method 2: Web Bluetooth (Chrome on Desktop/Android)
 * Connects to TM-m30II via BLE GATT and sends ESC/POS raster image
 */
async function printViaBluetooth() {
  if (!S.currentStrip) { toast('Chưa có ảnh để in', 'error'); return; }

  if (!navigator.bluetooth) {
    toast('Trình duyệt không hỗ trợ Bluetooth. Dùng Chrome!', 'error');
    return;
  }

  try {
    toast('Chọn máy in TM-m30II...', 'info');

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'TM-m30' },
        { namePrefix: 'EPSON' },
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', // Epson BLE Print
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Nordic UART
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Serial
      ],
      acceptAllDevices: false,
    }).catch(() =>
      // Fallback: show all BLE devices if no Epson found
      navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        ],
      })
    );

    toast(`Kết nối ${device.name || 'máy in'}...`, 'info');
    const server = await device.gatt.connect();

    // Find writable characteristic
    let writeChar = null;
    const services = await server.getPrimaryServices();

    for (const svc of services) {
      try {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            writeChar = ch;
            break;
          }
        }
        if (writeChar) break;
      } catch (e) { /* skip services that fail */ }
    }

    if (!writeChar) {
      toast('Không tìm thấy kênh BLE để gửi dữ liệu', 'error');
      server.disconnect();
      return;
    }

    toast('Đang chuyển đổi ảnh...', 'info');
    const printData = await imageToEscPos(S.currentStrip, 576);

    // Send in chunks (BLE MTU usually 20-512 bytes)
    const chunkSize = 200;
    const totalChunks = Math.ceil(printData.length / chunkSize);

    for (let i = 0; i < printData.length; i += chunkSize) {
      const chunk = printData.slice(i, i + chunkSize);
      const progress = Math.round(((i / chunkSize + 1) / totalChunks) * 100);

      try {
        if (writeChar.properties.writeWithoutResponse) {
          await writeChar.writeValueWithoutResponse(chunk);
        } else {
          await writeChar.writeValue(chunk);
        }
      } catch (writeErr) {
        // Retry with smaller chunk
        const smallChunk = 20;
        for (let j = 0; j < chunk.length; j += smallChunk) {
          const mini = chunk.slice(j, j + smallChunk);
          if (writeChar.properties.writeWithoutResponse) {
            await writeChar.writeValueWithoutResponse(mini);
          } else {
            await writeChar.writeValue(mini);
          }
          await wait(10);
        }
      }
      await wait(20);

      if (i % (chunkSize * 10) === 0) {
        toast(`Đang in... ${progress}%`, 'info');
      }
    }

    toast('✅ In thành công!', 'success');
    server.disconnect();
  } catch (err) {
    if (err.name === 'NotFoundError' || err.message?.includes('cancelled')) {
      // User cancelled picker — do nothing
    } else {
      toast(`Lỗi BLE: ${err.message}`, 'error');
      console.error('Bluetooth print error:', err);
    }
  }
}

/**
 * Convert image to ESC/POS raster commands (binary)
 */
async function imageToEscPos(dataUrl, widthPx) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = Math.round((img.height / img.width) * widthPx);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  // Grayscale + Floyd-Steinberg dithering
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * pixels[i*4] + 0.587 * pixels[i*4+1] + 0.114 * pixels[i*4+2];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const old = gray[idx];
      const val = old < 128 ? 0 : 255;
      gray[idx] = val;
      const err = old - val;
      if (x + 1 < w) gray[idx + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x - 1 >= 0) gray[(y+1)*w + x-1] += err * 3 / 16;
        gray[(y+1)*w + x] += err * 5 / 16;
        if (x + 1 < w) gray[(y+1)*w + x+1] += err * 1 / 16;
      }
    }
  }

  const bytesPerLine = Math.ceil(w / 8);
  const buffer = [];

  // ESC @ — initialize printer
  buffer.push(0x1B, 0x40);
  // GS v 0 — raster bit image (entire image at once)
  buffer.push(0x1D, 0x76, 0x30, 0x00);
  buffer.push(bytesPerLine & 0xFF, (bytesPerLine >> 8) & 0xFF);
  buffer.push(h & 0xFF, (h >> 8) & 0xFF);

  for (let y = 0; y < h; y++) {
    for (let xByte = 0; xByte < bytesPerLine; xByte++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        if (x < w && gray[y * w + x] < 128) {
          byte |= (0x80 >> bit);
        }
      }
      buffer.push(byte);
    }
  }

  // Feed + cut
  buffer.push(0x1B, 0x64, 0x05); // Feed 5 lines
  buffer.push(0x1D, 0x56, 0x41, 0x03); // Partial cut

  return new Uint8Array(buffer);
}

/**
 * Share/Save for mobile (iOS/Android)
 */
async function saveAndPrint() {
  if (!S.currentStrip) { toast('Chưa có ảnh để in', 'error'); return; }

  try {
    const blob = await (await fetch(S.currentStrip)).blob();
    const file = new File([blob], 'photobooth.jpg', { type: 'image/jpeg' });

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: S.stripTitle || 'Photo Booth' });
      toast('✓ Đã chia sẻ!', 'success');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `photobooth_${Date.now()}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✓ Đã tải xuống!', 'success');
  } catch (e) {
    if (e.name !== 'AbortError') toast('Lỗi: ' + e.message, 'error');
  }
}

/**
 * Show print options — different for mobile vs desktop
 */
async function showPrintOptions() {
  await composeStrip();

  const actions = $('.preview-actions');
  if (!actions) return;

  const hasPrinterIP = !!S.printerIP;
  const mobile = isMobile();
  const hasBluetooth = !!navigator.bluetooth;

  if (mobile) {
    // MOBILE: Save/Share + ePOS WiFi
    actions.innerHTML = `
      <div class="full-width" style="display:flex;flex-direction:column;gap:10px">
        <div style="text-align:center;padding:4px 0 8px">
          <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
            📱 Trên điện thoại:
          </div>
        </div>
        <div class="print-option-card" onclick="saveAndPrint()">
          <div class="print-option-icon save">📤</div>
          <div class="print-option-info">
            <h3>Lưu & Chia sẻ ảnh</h3>
            <p>Lưu ảnh → mở trong <b>Epson TM Utility</b> để in</p>
          </div>
        </div>
        <div class="print-option-card" onclick="printViaEpson()">
          <div class="print-option-icon bluetooth">🌐</div>
          <div class="print-option-info">
            <h3>In qua WiFi (ePOS)</h3>
            <p>${hasPrinterIP ? `IP: <b>${S.printerIP}</b> — nhấn để in!` : 'Nhập IP máy in khi có WiFi'}</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-block btn-sm" onclick="render()">← Quay lại</button>
      </div>
    `;
  } else {
    // DESKTOP (Mac/Windows): System Print + Bluetooth + ePOS
    actions.innerHTML = `
      <div class="full-width" style="display:flex;flex-direction:column;gap:10px">
        <div style="text-align:center;padding:4px 0 8px">
          <div style="font-size:12px;color:var(--text-muted);line-height:1.5">
            💻 Trên máy tính:
          </div>
        </div>
        <div class="print-option-card" onclick="printViaSystem()">
          <div class="print-option-icon save">🖨️</div>
          <div class="print-option-info">
            <h3>In qua hệ thống (macOS)</h3>
            <p>Chọn <b>TM-m30II</b> đã pair Bluetooth trong danh sách máy in</p>
          </div>
        </div>
        ${hasBluetooth ? `
        <div class="print-option-card" onclick="printViaBluetooth()">
          <div class="print-option-icon bluetooth">🔵</div>
          <div class="print-option-info">
            <h3>In trực tiếp qua Bluetooth</h3>
            <p>Kết nối BLE trực tiếp — gửi ảnh qua ESC/POS (Chrome)</p>
          </div>
        </div>
        ` : ''}
        <div class="print-option-card" onclick="printViaEpson()">
          <div class="print-option-icon bluetooth">🌐</div>
          <div class="print-option-info">
            <h3>In qua WiFi (ePOS)</h3>
            <p>${hasPrinterIP ? `IP: <b>${S.printerIP}</b> — nhấn để in!` : 'Nhập IP nếu máy in có WiFi'}</p>
          </div>
        </div>
        <button class="btn btn-ghost btn-block btn-sm" onclick="render()">← Quay lại</button>
      </div>
    `;
  }
}

/**
 * Method 2: Epson ePOS-Print XML API — direct network print via printer IP
 * The TM-m30II has a built-in web server that accepts print commands
 * This works from any browser on the same network
 */
async function printViaEpson() {
  if (!S.currentStrip) { toast('Chưa có ảnh để in', 'error'); return; }

  const ip = S.printerIP;
  if (!ip) {
    showPrinterIPSetup();
    return;
  }

  toast('Đang chuẩn bị ảnh in...', 'info');

  try {
    // Convert image to canvas for the ePOS API
    const img = await loadImage(S.currentStrip);
    const canvas = document.createElement('canvas');
    // TM-m30II: 576 dots width at 203dpi
    canvas.width = 576;
    canvas.height = Math.round((img.height / img.width) * 576);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Convert to monochrome raster data for ePOS XML
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rasterData = canvasToRasterBase64(imageData, canvas.width, canvas.height);

    // Build ePOS-Print XML command
    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
      <image width="${canvas.width}" height="${canvas.height}" color="color_1" mode="mono">${rasterData}</image>
      <feed unit="30"/>
      <cut type="feed"/>
    </epos-print>
  </s:Body>
</s:Envelope>`;

    toast('Đang gửi đến máy in...', 'info');

    // Send to printer's ePOS endpoint
    const url = `http://${ip}:8008/cgi-bin/epos/service.cgi?devid=local_printer&timeout=30000`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '""',
      },
      body: xmlBody,
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const text = await response.text();
      if (text.includes('success="true"') || text.includes('code=""')) {
        toast('✓ In thành công!', 'success');
      } else {
        toast('Máy in phản hồi lỗi. Kiểm tra giấy & kết nối.', 'error');
        console.log('ePOS response:', text);
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      toast('Không kết nối được. Kiểm tra IP máy in & cùng WiFi.', 'error');
    } else if (err.name === 'TimeoutError') {
      toast('Hết thời gian chờ. Kiểm tra máy in có bật không.', 'error');
    } else {
      toast(`Lỗi: ${err.message}`, 'error');
    }
    console.error('ePOS print error:', err);
  }
}

/**
 * Convert canvas ImageData to base64 raster data for ePOS-Print XML
 * Each pixel becomes 1 bit (monochrome) using Floyd-Steinberg dithering
 */
function canvasToRasterBase64(imageData, w, h) {
  const pixels = imageData.data;
  const gray = new Float32Array(w * h);

  // Convert to grayscale
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Floyd-Steinberg dithering for better photo quality
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const old = gray[idx];
      const val = old < 128 ? 0 : 255;
      gray[idx] = val;
      const err = old - val;
      if (x + 1 < w) gray[idx + 1] += err * 7 / 16;
      if (y + 1 < h) {
        if (x - 1 >= 0) gray[(y + 1) * w + x - 1] += err * 3 / 16;
        gray[(y + 1) * w + x] += err * 5 / 16;
        if (x + 1 < w) gray[(y + 1) * w + x + 1] += err * 1 / 16;
      }
    }
  }

  // Pack into bytes (1 bit per pixel, MSB first)
  const bytesPerRow = Math.ceil(w / 8);
  const rasterBytes = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] < 128) { // Black pixel = 1
        const byteIdx = y * bytesPerRow + Math.floor(x / 8);
        rasterBytes[byteIdx] |= (0x80 >> (x % 8));
      }
    }
  }

  // Convert to base64
  let binary = '';
  for (let i = 0; i < rasterBytes.length; i++) {
    binary += String.fromCharCode(rasterBytes[i]);
  }
  return btoa(binary);
}

/**
 * Show printer IP setup dialog
 */
function showPrinterIPSetup() {
  const actions = $('.preview-actions');
  if (!actions) return;

  actions.innerHTML = `
    <div class="full-width" style="display:flex;flex-direction:column;gap:12px">
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:28px;margin-bottom:8px">🌐</div>
        <div style="font-size:15px;font-weight:600">Nhập IP máy in Epson</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">TM-m30II phải cùng mạng WiFi</div>
      </div>
      <input type="text" class="strip-title-input" id="printer-ip-input"
             value="${S.printerIP}" placeholder="192.168.1.xxx"
             inputmode="decimal"
             style="text-align:center;font-size:18px;font-family:monospace;letter-spacing:1px">
      <button class="btn btn-accent btn-block" onclick="savePrinterIPAndPrint()">
        <span class="icon">🖨️</span> Lưu & In
      </button>
      <button class="btn btn-ghost btn-block btn-sm" onclick="render()">← Quay lại</button>
      <div style="font-size:11px;color:var(--text-muted);text-align:center;line-height:1.5">
        💡 Tìm IP trong cài đặt máy in hoặc in trang cấu hình<br>
        (giữ nút Feed khi bật máy)
      </div>
    </div>
  `;

  setTimeout(() => {
    const input = document.getElementById('printer-ip-input');
    if (input) input.focus();
  }, 100);
}

function savePrinterIPAndPrint() {
  const input = document.getElementById('printer-ip-input');
  const ip = input?.value?.trim();
  if (!ip) {
    toast('Vui lòng nhập địa chỉ IP', 'error');
    return;
  }
  // Basic IP validation
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    toast('IP không hợp lệ. Ví dụ: 192.168.1.100', 'error');
    return;
  }
  S.printerIP = ip;
  localStorage.setItem('epson_printer_ip', ip);
  toast(`Đã lưu IP: ${ip}`, 'success');
  render();
  // Trigger print
  setTimeout(() => printViaEpson(), 500);
}

// ===== RENDERING =====
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="toast-container" class="toast-container"></div>
    ${renderHomeScreen()}
    ${renderCameraScreen()}
    ${renderPreviewScreen()}
    ${renderGalleryScreen()}
  `;

  // After rendering camera screen, start camera if needed
  if (S.screen === 'camera') {
    requestAnimationFrame(() => startCamera());
  }
}

function screenClass(name) {
  if (S.screen === name) return 'screen';
  return 'screen hidden';
}

// ===== HOME =====
function renderHomeScreen() {
  return `
  <div class="${screenClass('home')} home-screen" id="screen-home">
    <div class="home-logo">📸</div>
    <h1 class="home-title">Photo Booth</h1>
    <p class="home-subtitle">Chụp · In · Chia sẻ</p>
    <div class="home-actions">
      <button class="btn btn-accent btn-block" onclick="startSession()">
        <span class="icon">📷</span> Bắt đầu chụp
      </button>
      <button class="btn btn-ghost btn-block" onclick="openGallery()">
        <span class="icon">🖼️</span> Gallery ${S.gallery.length > 0 ? `(${S.gallery.length})` : ''}
      </button>
    </div>
  </div>`;
}

// ===== CAMERA =====
function renderCameraScreen() {
  const filterLabel = {
    none: 'Gốc', bw: 'B&W', sepia: 'Sepia',
    vintage: 'Vintage', cool: 'Cool', warm: 'Warm',
  };

  return `
  <div class="${screenClass('camera')} camera-screen" id="screen-camera">
    <div class="camera-header">
      <button class="back-btn" onclick="cancelSession()">✕</button>
      <div class="camera-counter" id="camera-counter">
        <span>📸</span>
        <span id="photo-counter">${S.photos.length} / ${S.maxPhotos}</span>
      </div>
      <div class="camera-filter-label">${filterLabel[S.filter]}</div>
    </div>

    <div class="thumb-strip" id="thumb-strip">
      ${S.photos.map(p => `<img src="${p}" class="thumb-img" alt="">`).join('')}
    </div>

    <div class="camera-viewfinder">
      <video id="camera-video" autoplay playsinline muted
             style="filter:${getFilterCSS(S.filter)};${S.cameraFacing === 'user' ? 'transform:scaleX(-1);' : ''}"></video>
      <div class="countdown-overlay" id="countdown-overlay">
        <div class="countdown-number" id="countdown-number">3</div>
      </div>
      <div class="flash-overlay" id="flash-overlay"></div>
    </div>

    <div class="filter-strip">
      ${['none','bw','sepia','vintage','cool','warm'].map(f => `
        <button class="filter-chip ${S.filter === f ? 'active' : ''}"
                onclick="setFilter('${f}')">${filterLabel[f]}</button>
      `).join('')}
    </div>

    <div class="camera-controls">
      <button class="camera-side-btn" onclick="flipCamera()">🔄</button>
      <button class="shutter-btn" id="shutter-btn" onclick="captureSingle()"></button>
      <button class="camera-side-btn" onclick="startAutoSequence()">⏱️</button>
    </div>
  </div>`;
}

// ===== PREVIEW =====
function renderPreviewScreen() {
  const stripBg = { white: '#fff', vintage: '#f5f0e8', dark: '#1a1a1a', pink: '#fce4ec' };
  const textColor = S.stripStyle === 'dark' ? '#f0f0f0' : '#1a1a1a';

  return `
  <div class="${screenClass('preview')} preview-screen" id="screen-preview">
    <div class="preview-header">
      <button class="btn btn-sm btn-ghost" onclick="retakePhotos()">
        <span class="icon">↩</span> Chụp lại
      </button>
      <div class="preview-title">Kết quả</div>
      <button class="btn btn-sm btn-ghost" onclick="show('home')">✕</button>
    </div>

    <div class="strip-container">
      <div class="photo-strip ${S.stripStyle}" id="photo-strip">
        <div class="strip-photos">
          ${S.photos.map(p => `<img src="${p}" class="strip-photo" alt="">`).join('')}
        </div>
        <div class="strip-footer">
          <div class="strip-title" style="color:${textColor}">${S.stripTitle}</div>
          <div class="strip-date">${formatDate(new Date())}</div>
        </div>
      </div>
    </div>

    <div class="customize-section">
      <div class="section-title">🎨 Kiểu khung</div>
      <div class="strip-style-options">
        ${[
          { id: 'white', label: 'Trắng', bg: '#fff' },
          { id: 'vintage', label: 'Vintage', bg: '#f5f0e8' },
          { id: 'dark', label: 'Tối', bg: '#1a1a1a' },
          { id: 'pink', label: 'Hồng', bg: '#fce4ec' },
        ].map(s => `
          <div class="style-option ${S.stripStyle === s.id ? 'active' : ''}"
               onclick="setStripStyle('${s.id}')"
               style="background:${s.bg}">
            <div class="style-preview">
              <div class="mini-rect"></div>
              <div class="mini-rect"></div>
              <div class="mini-rect"></div>
            </div>
            <div class="style-label">${s.label}</div>
          </div>
        `).join('')}
      </div>

      <div class="section-title">✏️ Tiêu đề</div>
      <input type="text" class="strip-title-input" id="strip-title-input"
             value="${S.stripTitle}" placeholder="Nhập tiêu đề..."
             oninput="updateStripTitle(this.value)">
    </div>

    <div class="preview-actions">
      <button class="btn btn-accent full-width" onclick="showPrintOptions()">
        <span class="icon">🖨️</span> In ảnh
      </button>
      <button class="btn btn-ghost" onclick="downloadCurrentStrip()">
        <span class="icon">⬇️</span> Tải xuống
      </button>
      <button class="btn btn-ghost" onclick="saveAndShowToast()">
        <span class="icon">💾</span> Lưu Gallery
      </button>
      <button class="btn btn-ghost" onclick="shareStrip()">
        <span class="icon">↗️</span> Chia sẻ
      </button>
    </div>
  </div>`;
}

// ===== GALLERY =====
function renderGalleryScreen() {
  return `
  <div class="${screenClass('gallery')} gallery-screen" id="screen-gallery">
    <div class="gallery-header">
      <button class="btn btn-sm btn-ghost" onclick="show('home')">
        <span class="icon">←</span> Về
      </button>
      <div class="preview-title">Gallery</div>
      <div style="width:60px"></div>
    </div>

    ${S.gallery.length === 0 ? `
      <div class="gallery-empty">
        <div class="icon">🖼️</div>
        <p>Chưa có ảnh nào.<br>Bắt đầu chụp để tạo photo strip!</p>
      </div>
    ` : `
      <div class="gallery-grid">
        ${S.gallery.map(g => `
          <div class="gallery-item" onclick="viewGalleryItem('${g.id}')">
            <img src="${g.dataUrl}" alt="${g.title}">
            <div class="gallery-item-info">
              <div class="gallery-item-date">${formatDate(g.date)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  </div>`;
}

// ===== ACTIONS =====
function startSession() {
  S.photos = [];
  S.currentStrip = null;
  show('camera');
}

function cancelSession() {
  stopCamera();
  S.photos = [];
  show('home');
}

function retakePhotos() {
  S.photos = [];
  S.currentStrip = null;
  show('camera');
}

function setFilter(f) {
  S.filter = f;
  applyFilterToVideo();
  // Update filter chips
  $$('.filter-chip').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');
  // Update label
  const labels = { none: 'Gốc', bw: 'B&W', sepia: 'Sepia', vintage: 'Vintage', cool: 'Cool', warm: 'Warm' };
  const label = $('.camera-filter-label');
  if (label) label.textContent = labels[f];
}

function setStripStyle(style) {
  S.stripStyle = style;
  render();
}

function updateStripTitle(val) {
  S.stripTitle = val;
  const titleEl = $('.strip-title');
  if (titleEl) titleEl.textContent = val;
}

async function startAutoSequence() {
  // Auto-capture remaining photos with countdown
  if (S.photos.length >= S.maxPhotos) return;
  startCaptureSequence();
}

async function downloadCurrentStrip() {
  toast('Đang tạo ảnh...', 'info');
  await composeStrip();
  downloadStrip();
}

async function saveAndShowToast() {
  await composeStrip();
  saveToGallery();
}

async function shareStrip() {
  await composeStrip();
  if (navigator.share && S.currentStrip) {
    try {
      const blob = await (await fetch(S.currentStrip)).blob();
      const file = new File([blob], 'photobooth.jpg', { type: 'image/jpeg' });
      await navigator.share({
        title: S.stripTitle,
        files: [file],
      });
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast('Không thể chia sẻ', 'error');
      }
    }
  } else {
    downloadStrip();
    toast('Đã tải xuống (chia sẻ không khả dụng)', 'info');
  }
}



function viewGalleryItem(id) {
  const item = S.gallery.find(g => g.id === id);
  if (!item) return;

  S.currentStrip = item.dataUrl;
  S.stripTitle = item.title || 'Photo Booth';

  // Build a simple view
  const screen = $('#screen-gallery');
  screen.innerHTML = `
    <div class="preview-header">
      <button class="btn btn-sm btn-ghost" onclick="openGallery()">
        <span class="icon">←</span> Gallery
      </button>
      <div class="preview-title">${item.title || 'Photo'}</div>
      <button class="btn btn-sm btn-danger" onclick="deleteFromGallery('${id}')">🗑️</button>
    </div>
    <div class="strip-container" style="padding-top:16px">
      <img src="${item.dataUrl}" style="max-width:320px;width:100%;border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,.6)">
    </div>
    <div class="preview-actions" style="margin-top:16px">
      <button class="btn btn-ghost" onclick="downloadGalleryItem('${id}')">
        <span class="icon">⬇️</span> Tải
      </button>
      <button class="btn btn-ghost" onclick="shareGalleryItem('${id}')">
        <span class="icon">↗️</span> Chia sẻ
      </button>
      <button class="btn btn-accent full-width" onclick="printGalleryItem('${id}')">
        <span class="icon">🖨️</span> In ảnh
      </button>
    </div>
  `;
}

function downloadGalleryItem(id) {
  const item = S.gallery.find(g => g.id === id);
  if (!item) return;
  S.currentStrip = item.dataUrl;
  downloadStrip();
}

async function shareGalleryItem(id) {
  const item = S.gallery.find(g => g.id === id);
  if (!item) return;
  S.currentStrip = item.dataUrl;
  S.stripTitle = item.title;
  await shareStrip();
}

async function printGalleryItem(id) {
  const item = S.gallery.find(g => g.id === id);
  if (!item) return;
  S.currentStrip = item.dataUrl;
  printViaBrowser();
}

function openGallery() {
  show('gallery');
}

// ===== EXPOSE TO WINDOW =====
window.startSession = startSession;
window.cancelSession = cancelSession;
window.retakePhotos = retakePhotos;
window.captureSingle = captureSingle;
window.startAutoSequence = startAutoSequence;
window.setFilter = setFilter;
window.setStripStyle = setStripStyle;
window.updateStripTitle = updateStripTitle;
window.flipCamera = flipCamera;
window.downloadCurrentStrip = downloadCurrentStrip;
window.saveAndShowToast = saveAndShowToast;
window.shareStrip = shareStrip;
window.showPrintOptions = showPrintOptions;
window.printViaBrowser = saveAndPrint; // legacy alias
window.saveAndPrint = saveAndPrint;
window.printViaBluetooth = printViaBluetooth;
window.printViaSystem = printViaSystem;
window.printViaEpson = printViaEpson;
window.showPrinterIPSetup = showPrinterIPSetup;
window.savePrinterIPAndPrint = savePrinterIPAndPrint;
window.openGallery = openGallery;
window.viewGalleryItem = viewGalleryItem;
window.deleteFromGallery = deleteFromGallery;
window.downloadGalleryItem = downloadGalleryItem;
window.shareGalleryItem = shareGalleryItem;
window.printGalleryItem = printGalleryItem;
window.show = show;
window.render = render;

// ===== INIT =====
loadGallery();
render();
