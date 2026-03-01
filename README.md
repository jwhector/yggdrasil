# Yggdrasil

An interactive live performance system where an audience collectively builds a song in real time through binary voting, consensus thresholds, and a collaborative finale.

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# (Optional) Configure environment variables
cp .env.example .env
# Edit .env to customize server settings

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
# Option 1: Use environment variable
HOST=0.0.0.0 npm run dev

# Option 2: Configure in .env file
# Set HOST=0.0.0.0 in .env, then:
npm run dev

# Option 3: Use the network script (sets HOST=0.0.0.0 automatically)
npm run dev:network

# Find your computer's IP address (macOS Wi-Fi)
ipconfig getifaddr en0
```

Then on your phone (same Wi-Fi network):
```
http://YOUR_IP:3000/audience?seat=A1
```

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

## Configuration

Environment variables can be set via `.env` file. Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

Key configuration options:

- **HOST/PORT** — Server binding (use `HOST=0.0.0.0` for network access)
- **OSC_ENABLED** — Enable/disable Ableton Live integration
- **TIMING_ENGINE_ENABLED** — Enable/disable automatic timing
- **PERIODIC_BACKUP** — Enable automatic periodic backups
- **NODE_ENV** — Set to `production` for production builds

See `.env.example` for complete documentation of all options.

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
