/**
 * Persistent localtunnel script for Anveshan Tracking Panel
 * Creates a public HTTPS URL that forwards to localhost:5173
 *
 * Usage:  node tunnel.js
 * URL:    https://anveshan-panel.loca.lt
 */

const localtunnel = require('localtunnel');

const PORT = 5173;
const SUBDOMAIN = 'anveshan-panel';
let retries = 0;

async function startTunnel() {
  try {
    console.log(`\n🔗 Starting tunnel to localhost:${PORT} ...`);
    const tunnel = await localtunnel({ port: PORT, subdomain: SUBDOMAIN });

    retries = 0;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ✅  ANVESHAN TRACKING PANEL — PUBLIC URL`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  🌐  ${tunnel.url}`);
    console.log(`  📡  LAN: http://${getLocalIP()}:${PORT}`);
    console.log(`  🏠  Local: http://localhost:${PORT}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`\n  Share the URL above to access from any device.`);
    console.log(`  First-time visitors click "Click to Continue" on the splash page.\n`);
    console.log(`  Press Ctrl+C to stop.\n`);

    tunnel.on('close', () => {
      console.log('\n⚠️  Tunnel closed. Reconnecting in 3s...');
      setTimeout(startTunnel, 3000);
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err.message);
    });

  } catch (err) {
    retries++;
    const delay = Math.min(retries * 3, 30);
    console.error(`❌ Failed to start tunnel: ${err.message}`);
    console.log(`   Retrying in ${delay}s... (attempt ${retries})`);
    setTimeout(startTunnel, delay * 1000);
  }
}

function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// Keep process alive — heartbeat every 30s prevents Node from exiting
const keepAlive = setInterval(() => {}, 30000);

process.on('SIGINT', () => {
  clearInterval(keepAlive);
  console.log('\n🛑 Tunnel stopped.');
  process.exit(0);
});

startTunnel();
