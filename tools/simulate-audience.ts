// tools/simulate-audience.ts
import { io } from 'socket.io-client';

const NUM_BOTS = 40;
const ALIGNMENT = 0.7; // 70% vote the same way

const bots = Array.from({ length: NUM_BOTS }, (_, i) => {
  const socket = io('http://localhost:3000');
  const botId = i + 1;
  const votedLayerKeys = new Set<string>();

  console.log(`[bot ${botId}] created`);

  socket.on('connect', () => {
    console.log(`[bot ${botId}] connected (${socket.id ?? 'no-socket-id'})`);
    socket.emit('join', { mode: 'audience' });
    console.log(`[bot ${botId}] join emitted`);
  });

  socket.on('ping', () => {
    socket.emit('pong');
  });

  socket.on('identity', (data) => {
    console.log(`[bot ${botId}] identity userId=${data.userId}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[bot ${botId}] disconnected (${reason})`);
  });

  socket.on('connect_error', (error) => {
    console.error(`[bot ${botId}] connect_error: ${error.message}`);
  });
  
  socket.on('state_sync', (state) => {
    const attemptIndex = state.currentAttempt?.index;
    const layerIndex = state.currentAttempt?.currentLayerIndex;
    const layerPhase = state.currentAttempt?.currentLayerPhase ?? 'n/a';
    console.log(`[bot ${botId}] state_sync phase=${state.phase} layerPhase=${layerPhase}`);

    // Auto-vote when voting opens
    if (layerPhase === 'auditioning' && typeof attemptIndex === 'number' && typeof layerIndex === 'number' && ) {
      const layerKey = `${attemptIndex}:${layerIndex}`;
      if (votedLayerKeys.has(layerKey)) return;

      const choice = Math.random() < ALIGNMENT ? 'A' : 'B';
      console.log(`[bot ${botId}] voting ${choice}`);
      socket.emit('vote', { choice });
      votedLayerKeys.add(layerKey);
    }
  });
  
  return socket;
});