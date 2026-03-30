# OSC Bridge

Relays OSC messages between the cloud-hosted Yggdrasil server and Ableton Live running on the performer's laptop.

## Why

When the server runs on Railway (or any cloud host), it can't send UDP directly to Ableton on your local machine. This bridge script runs alongside Ableton and tunnels OSC over WebSocket.

## Architecture

```
Railway Server                          Performer's Laptop
┌─────────────────────┐                ┌──────────────────────┐
│ Conductor            │                │                      │
│   ↓ events           │                │  osc-bridge.ts       │
│ Audio Router         │   Socket.IO    │  (this script)       │
│   ↓ OSC calls        │◄─────────────►│                      │
│ Remote OSC Bridge    │  osc_send →    │  ↓ UDP               │
│                      │  ← osc_receive │  Ableton (port 11000)│
│ Timing Engine        │                │  AbletonOSC (11001)  │
└─────────────────────┘                └──────────────────────┘
```

## Setup

1. **Server** — set `OSC_MODE=remote` on Railway (instead of `OSC_ENABLED=true`)
2. **Performer's laptop** — run the bridge:

```bash
SERVER_URL=https://your-app.up.railway.app npm run bridge
```

3. Open Ableton with AbletonOSC loaded

The bridge auto-reconnects if the server connection drops.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SERVER_URL` | (required) | Yggdrasil server URL |
| `OSC_SEND_PORT` | `11000` | UDP port for sending to Ableton |
| `OSC_RECEIVE_PORT` | `11001` | UDP port for receiving from Ableton |
| `ABLETON_HOST` | `127.0.0.1` | Ableton host address |

## Latency

The WebSocket relay adds ~10-50ms per message. At 120 BPM (500ms per beat), this is well within tolerance for beat-locked fades.
