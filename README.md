# Yggdrasil

An interactive live performance system where an audience collectively builds a song in real time, embodying factions of the performer's subconscious.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server (Next.js + Socket.IO on port 3000)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

### Testing with Real Devices

To test the audience UI on actual phones/tablets:

```bash
# 1. Find your computer's IP address
ipconfig getifaddr en0  # macOS Wi-Fi

# 2. Start server for network access (binds to 0.0.0.0)
npm run dev:network
```

Then on your phone (same Wi-Fi network):
```
http://YOUR_IP:3000/audience?seat=A1
```

**📱 Full testing guide:** See [TESTING.md](TESTING.md) for comprehensive testing instructions, troubleshooting, and pre-performance checklists.

## Architecture

This project uses Next.js with a custom server to enable persistent WebSocket connections:

```
Custom Server (Node.js)
├── Next.js (page routes)
├── Socket.IO (real-time)
├── SQLite (persistence)
└── Conductor (pure game logic)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete system documentation.

## Project Structure

```
yggdrasil/
├── conductor/        # Pure game logic (no I/O)
├── server/           # Custom server (Next.js + Socket.IO)
├── app/              # Next.js App Router pages
├── components/       # React components
├── hooks/            # React hooks
├── lib/              # Shared utilities
└── config/           # Show configuration
```

## Client Routes

- `http://localhost:3000/audience` — Audience member UI (join via QR code)
- `http://localhost:3000/projector` — Display for projection
- `http://localhost:3000/controller` — Performer control interface

## For AI Agents

If you're an AI coding assistant working on this project:

1. **Read CLAUDE.md first** — quick context for Claude Code
2. **Read ARCHITECTURE.md** — complete system specification
3. **Check DECISIONS.md** — design choices and open questions
4. **Update docs** — if your changes affect architecture

## Development

Start with the conductor (pure logic, easy to test):

```bash
npm run test:conductor
```

Then work on server, then client components.

## License

Private — not for distribution.
