import { defineConfig } from 'vite';
import net from 'net';

/**
 * Vite plugin: Print proxy for Epson TM-m30II
 * Adds POST /api/print endpoint that sends ESC/POS raster data to printer via TCP:9100
 */
function epsonPrintPlugin() {
  return {
    name: 'epson-print-proxy',
    configureServer(server) {
      server.middlewares.use('/api/print', async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method not allowed'); return; }

        // Read body
        let body = '';
        for await (const chunk of req) body += chunk;

        try {
          const { ip, width, height, rasterBase64 } = JSON.parse(body);
          if (!ip || !rasterBase64) throw new Error('Missing ip or rasterBase64');

          const rasterBytes = Buffer.from(rasterBase64, 'base64');
          const wBytes = Math.ceil(width / 8);  // width in bytes

          // Build ESC/POS command
          const commands = Buffer.concat([
            Buffer.from([0x1B, 0x40]),                // ESC @ — Initialize
            Buffer.from([0x1D, 0x76, 0x30, 0x00]),    // GS v 0 — Print raster
            Buffer.from([wBytes & 0xFF, (wBytes >> 8) & 0xFF]),  // xL, xH
            Buffer.from([height & 0xFF, (height >> 8) & 0xFF]),  // yL, yH
            rasterBytes,                               // Image data
            Buffer.from([0x1D, 0x56, 0x42, 0x03]),    // GS V B — Partial cut with feed
          ]);

          // Send to printer via TCP:9100
          await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            socket.setTimeout(10000);
            socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
            socket.on('error', reject);
            socket.connect(9100, ip, () => {
              socket.write(commands, () => {
                // Give printer time to process
                setTimeout(() => { socket.destroy(); resolve(); }, 1000);
              });
            });
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Print sent!' }));
        } catch (err) {
          console.error('Print error:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });

      // Test connection endpoint
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

export default defineConfig({
  plugins: [epsonPrintPlugin()],
});
