import { defineConfig } from 'vite';
import net from 'net';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Vite plugin: Print proxy for Epson TM-m30II
 * /api/print       — raster image print
 * /api/print-danke — native ESC/POS text (razor sharp!)
 * /api/test-printer — connection test
 */
function epsonPrintPlugin() {
  return {
    name: 'epson-print-proxy',
    configureServer(server) {

      // ---- Raster image print (supports TALL images via banding) ----
      server.middlewares.use('/api/print', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }

        let body = '';
        for await (const chunk of req) body += chunk;

        try {
          const { ip, width, height, rasterBase64 } = JSON.parse(body);
          if (!ip || !rasterBase64) throw new Error('Missing ip or rasterBase64');

          const rasterBytes = Buffer.from(rasterBase64, 'base64');
          const wBytes = Math.ceil(width / 8);
          const BAND_HEIGHT = 256; // lines per band (safe for printer buffer)

          const parts = [];
          // Initialize printer
          parts.push(Buffer.from([0x1B, 0x40])); // ESC @

          // Split image into bands for tall images
          let offset = 0;
          for (let y = 0; y < height; y += BAND_HEIGHT) {
            const bandH = Math.min(BAND_HEIGHT, height - y);
            const bandSize = wBytes * bandH;
            const bandData = rasterBytes.slice(offset, offset + bandSize);

            // GS v 0 — Print raster band
            parts.push(Buffer.from([0x1D, 0x76, 0x30, 0x00]));
            parts.push(Buffer.from([wBytes & 0xFF, (wBytes >> 8) & 0xFF]));
            parts.push(Buffer.from([bandH & 0xFF, (bandH >> 8) & 0xFF]));
            parts.push(bandData);
            offset += bandSize;
          }

          // Partial cut after all bands printed
          parts.push(Buffer.from([0x1D, 0x56, 0x42, 0x03])); // GS V B

          const commands = Buffer.concat(parts);
          console.log(`Printing: ${width}x${height}px, ${Math.ceil(height/BAND_HEIGHT)} bands, ${commands.length} bytes`);

          await sendToPrinter(ip, commands);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          console.error('Print error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });

      // ---- Danke-Beleg: native ESC/POS text (sharp!) ----
      server.middlewares.use('/api/print-danke', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.end(); return; }

        let body = '';
        for await (const chunk of req) body += chunk;

        try {
          const { ip, logoRaster, logoWidth, logoHeight } = JSON.parse(body);
          if (!ip) throw new Error('Missing ip');

          const ESC = 0x1B, GS = 0x1D;
          const parts = [];

          // Initialize
          parts.push(Buffer.from([ESC, 0x40]));

          // Set encoding for German chars
          parts.push(Buffer.from([ESC, 0x74, 0x13])); // Code page 858 (Western Europe with €)

          // Center align
          parts.push(Buffer.from([ESC, 0x61, 0x01]));

          // === Print logo as raster image (if provided) ===
          if (logoRaster && logoWidth && logoHeight) {
            const rasterBytes = Buffer.from(logoRaster, 'base64');
            const wBytes = Math.ceil(logoWidth / 8);
            parts.push(Buffer.from([GS, 0x76, 0x30, 0x00]));
            parts.push(Buffer.from([wBytes & 0xFF, (wBytes >> 8) & 0xFF]));
            parts.push(Buffer.from([logoHeight & 0xFF, (logoHeight >> 8) & 0xFF]));
            parts.push(rasterBytes);
            parts.push(Buffer.from([ESC, 0x64, 0x01])); // Feed 1 line
          }

          // === Decorative line ===
          parts.push(Buffer.from([ESC, 0x61, 0x01])); // Center
          parts.push(Buffer.from('________________________________________________\n'));
          parts.push(Buffer.from('\n'));

          // === "Vielen Dank" — Double height + Double width ===
          parts.push(Buffer.from([GS, 0x21, 0x11])); // Double width + height
          parts.push(Buffer.from([ESC, 0x45, 0x01])); // Bold ON
          parts.push(Buffer.from('Vielen Dank\n'));
          parts.push(Buffer.from([GS, 0x21, 0x00])); // Normal size
          parts.push(Buffer.from([ESC, 0x45, 0x00])); // Bold OFF

          // "für Ihre Bestellung!" — Double height only
          parts.push(Buffer.from([GS, 0x21, 0x01])); // Double height
          parts.push(Buffer.from('f\xFCr Ihre Bestellung!\n')); // ü = 0xFC in CP858
          parts.push(Buffer.from([GS, 0x21, 0x00])); // Normal
          parts.push(Buffer.from('\n'));

          // === Separator ===
          parts.push(Buffer.from('________________________________\n'));
          parts.push(Buffer.from('\n'));

          // === Friendly message — emphasized ===
          parts.push(Buffer.from([ESC, 0x45, 0x01])); // Bold
          parts.push(Buffer.from([GS, 0x21, 0x01])); // Double height
          parts.push(Buffer.from('Wir hoffen,\n'));
          parts.push(Buffer.from('es schmeckt Ihnen!\n'));
          parts.push(Buffer.from([GS, 0x21, 0x00])); // Normal
          parts.push(Buffer.from([ESC, 0x45, 0x00])); // Bold off
          parts.push(Buffer.from('\n'));

          parts.push(Buffer.from([GS, 0x21, 0x01])); // Double height
          parts.push(Buffer.from('Wir freuen uns auf Ihren\n'));
          parts.push(Buffer.from('n\xE4chsten Besuch.\n')); // ä = 0xE4
          parts.push(Buffer.from([GS, 0x21, 0x00])); // Normal
          parts.push(Buffer.from('\n'));

          // === Separator ===
          parts.push(Buffer.from('________________________________\n'));
          parts.push(Buffer.from('\n'));

          // === Team signature — bold double ===
          parts.push(Buffer.from([ESC, 0x45, 0x01])); // Bold
          parts.push(Buffer.from([GS, 0x21, 0x11])); // Double W+H
          parts.push(Buffer.from('Ihr ORIGAMI Team\n'));
          parts.push(Buffer.from([GS, 0x21, 0x00]));
          parts.push(Buffer.from([ESC, 0x45, 0x00]));
          parts.push(Buffer.from('\n'));

          // === Date & Time ===
          const now = new Date();
          const dateStr = now.toLocaleDateString('de-DE', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
          });
          const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
          parts.push(Buffer.from([GS, 0x21, 0x01])); // Double height
          parts.push(Buffer.from(`${dateStr}\n`));
          parts.push(Buffer.from(`${timeStr} Uhr\n`));
          parts.push(Buffer.from([GS, 0x21, 0x00]));

          // === Bottom ornament ===
          parts.push(Buffer.from('\n'));
          parts.push(Buffer.from('________________________________________________\n'));

          // Feed and cut
          parts.push(Buffer.from([ESC, 0x64, 0x04])); // Feed 4 lines
          parts.push(Buffer.from([GS, 0x56, 0x42, 0x03])); // Partial cut

          const allCommands = Buffer.concat(parts);
          await sendToPrinter(ip, allCommands);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          console.error('Danke print error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });

      // ---- Test connection ----
      server.middlewares.use('/api/test-printer', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') { res.end(); return; }

        let body = '';
        for await (const chunk of req) body += chunk;

        try {
          const { ip } = JSON.parse(body);
          await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            socket.setTimeout(3000);
            socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
            socket.on('error', reject);
            socket.connect(9100, ip, () => { socket.destroy(); resolve(); });
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    },
  };
}

/** Send raw bytes to printer via TCP:9100 */
function sendToPrinter(ip, data) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(30000); // 30s for large images
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
    socket.on('error', reject);
    socket.connect(9100, ip, () => {
      socket.write(data, () => {
        // Wait longer for tall images (proportional to data size)
        const waitMs = Math.max(1500, Math.min(5000, Math.round(data.length / 10000)));
        setTimeout(() => { socket.destroy(); resolve(); }, waitMs);
      });
    });
  });
}

export default defineConfig({
  plugins: [epsonPrintPlugin()],
});
