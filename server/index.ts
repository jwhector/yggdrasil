/**
 * Yggdrasil Custom Server
 * 
 * This file creates an HTTP server that:
 * 1. Serves Next.js pages (app/ routes)
 * 2. Handles Socket.IO connections (real-time events)
 * 3. Manages SQLite persistence
 * 4. Runs the Conductor (game logic)
 * 
 * Start with: npm run dev (development) or npm run start (production)
 */

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';

// TODO: Import these once implemented
// import { createConductor } from '@/conductor';
// import { createPersistence } from './persistence';
// import { setupSocketHandlers } from './socket';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

async function main() {
  // Initialize Next.js
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  
  await app.prepare();
  
  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });
  
  // Attach Socket.IO
  const io = new SocketIOServer(server, {
    cors: {
      origin: dev ? '*' : false,
    },
    // Reconnection settings
    pingTimeout: 5000,
    pingInterval: 15000,
  });
  
  // TODO: Initialize persistence
  // const db = await createPersistence('./data/yggdrasil.db');
  
  // TODO: Initialize conductor
  // const conductor = createConductor(db);
  
  // TODO: Setup socket handlers
  // setupSocketHandlers(io, conductor);
  
  // Placeholder: log connections
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
  
  // Start server
  server.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      YGGDRASIL                            ║
║              Interactive Performance System               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at http://${hostname}:${port}                  ║
║                                                           ║
║  Routes:                                                  ║
║    /audience    - Audience member UI                      ║
║    /projector   - Projector display                       ║
║    /controller  - Performer controls                      ║
╚═══════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
