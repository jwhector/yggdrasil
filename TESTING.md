# Yggdrasil Testing Guide

This document provides instructions for testing the Yggdrasil interactive performance system during development and before live performances.

---

## Local Development Testing

### Single Machine Testing

For basic testing on your development machine:

```bash
npm run dev
```

Then open in your browser:
- Controller: http://localhost:3000/controller
- Projector: http://localhost:3000/projector
- Audience: http://localhost:3000/audience?seat=A1

You can open multiple audience tabs with different seat IDs (A1, A2, B1, etc.) to simulate multiple users.

---

## Multi-Device Testing (Local Network)

To test with real phones/tablets on your local network:

### 1. Find Your Computer's IP Address

**macOS:**
```bash
# Get Wi-Fi IP
ipconfig getifaddr en0

# Or get all network interfaces
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**Linux:**
```bash
hostname -I
# or
ip addr show
```

**Windows:**
```bash
ipconfig
# Look for "IPv4 Address" under your active network adapter
```

You'll get an IP like `192.168.1.100` or `10.0.0.5`

### 2. Start the Server for Network Access

```bash
npm run dev:network
```

This starts the server on `0.0.0.0` (all network interfaces) instead of just `localhost`.

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║                      YGGDRASIL                            ║
║              Interactive Performance System               ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at http://0.0.0.0:3000                    ║
║                                                           ║
║  Routes:                                                  ║
║    /audience    - Audience member UI                      ║
║    /projector   - Projector display                       ║
║    /controller  - Performer controls                      ║
║                                                           ║
║  Network Access: Enabled (all interfaces)                 ║
╚═══════════════════════════════════════════════════════════╝
```

### 3. Connect from Other Devices

Make sure your phone/tablet is on the **same Wi-Fi network** as your computer.

Then open:
```
http://192.168.1.100:3000/audience?seat=A1
```
(Replace `192.168.1.100` with your actual IP address)

**For different audience members, use different seat IDs:**
- Phone 1: `http://192.168.1.100:3000/audience?seat=A1`
- Phone 2: `http://192.168.1.100:3000/audience?seat=A2`
- Tablet: `http://192.168.1.100:3000/audience?seat=B1`

### Troubleshooting Network Access

**Can't connect from other devices?**

1. **Firewall:** Make sure your computer's firewall allows incoming connections on port 3000
   - macOS: System Settings → Network → Firewall
   - Windows: Windows Defender Firewall → Allow an app
   - Linux: `sudo ufw allow 3000`

2. **Wrong network:** Ensure all devices are on the same Wi-Fi network

3. **VPN:** Disconnect from VPNs that might block local network access

4. **IP changed:** Your computer's IP can change. Re-run the IP address command if devices stop connecting

---

## Full Show Walkthrough

Test the complete show flow with multiple clients:

### Setup (3 devices minimum)
1. **Controller** (your laptop): Open `/controller`
2. **Projector** (external display or tablet): Open `/projector`
3. **Audience** (phone): Open `/audience?seat=A1` (repeat for more phones)

### Test Flow

#### 1. Lobby Phase
- [ ] Audience sees "What lives on your fig tree?" prompt
- [ ] Audience can type response and submit
- [ ] After submission, see "Waiting for show to start"
- [ ] Controller shows user count increasing

#### 2. Faction Assignment
- [ ] Controller clicks "Assign Factions"
- [ ] Audience sees faction reveal animation with color
- [ ] Projector shows faction distribution
- [ ] Controller shows faction counts

#### 3. Start Show
- [ ] Controller clicks "Start Show"
- [ ] All clients transition to running phase

#### 4. Auditioning Phase
- [ ] Audience sees "Listen" screen with 4 options
- [ ] Current audition option highlights
- [ ] Audio plays (if Ableton connected)
- [ ] Transitions automatically to voting

#### 5. Voting Phase
- [ ] Audience sees vote interface
- [ ] Tap option once → Faction vote indicator appears
- [ ] Tap option again → Personal vote indicator appears
- [ ] Submit button activates when both votes cast
- [ ] Can update votes before window closes

#### 6. Reveal Phase
- [ ] Projector shows coherence bars
- [ ] Winning faction highlighted
- [ ] Popular vote shown (if different from faction choice)
- [ ] Audience sees "Watch the projector"

#### 7. Coup Window
- [ ] If configured, coup window appears
- [ ] Audience sees coup meter for their faction only
- [ ] Vote to coup button appears
- [ ] Progress bar updates as faction members vote
- [ ] If threshold reached, row resets with multiplier

#### 8. Repeat Rows
- [ ] Advance through all configured rows
- [ ] Path builds on projector (faction + popular)

#### 9. Finale
- [ ] Force finale from controller (or automatic after all rows)
- [ ] Popular path song plays
- [ ] Individual timelines play with fig tree responses
- [ ] Audience sees "Watch the projector for your personal timeline"

---

## Emergency Controls Testing

### Pause/Resume
- [ ] Controller clicks "Pause"
- [ ] All clients show "Show paused"
- [ ] Controller clicks "Resume"
- [ ] Show continues from paused state

### Reset to Lobby
- [ ] Controller clicks "Reset to Lobby"
- [ ] Confirmation dialog appears
- [ ] After confirm, all clients return to lobby
- [ ] Users remain connected (preserveUsers: true)

### Export/Import State
- [ ] Controller clicks "Export State"
- [ ] JSON file downloads
- [ ] Modify some values in JSON
- [ ] Controller clicks "Import State"
- [ ] Select modified JSON
- [ ] State updates across all clients

---

## Reconnection Testing

### Audience Reconnection
1. Disconnect audience member (close browser or airplane mode)
2. Wait 10 seconds
3. Reconnect same device to same URL
4. Should automatically reconnect with same identity
5. State should sync to current position

### Server Restart Recovery
1. Kill server process (Ctrl+C)
2. Restart server (`npm run dev:network`)
3. Reconnect all clients
4. State should load from database
5. Show continues from last saved state

---

## Performance Testing

### Load Testing (30+ concurrent users)
1. Open 30+ audience tabs (or use actual devices)
2. All submit votes simultaneously
3. Monitor server console for performance
4. Check for lag or missed updates
5. Verify all votes received in controller

### Network Resilience
1. Enable network throttling in browser DevTools
   - Chrome: DevTools → Network → Throttling → Slow 3G
2. Test voting with simulated lag
3. Verify votes eventually reach server
4. Test reconnection with poor connection

---

## Pre-Performance Checklist

**1 Week Before:**
- [ ] Full walkthrough with all actual devices
- [ ] Test venue Wi-Fi network reliability
- [ ] Verify firewall settings on performance laptop
- [ ] Create and test QR codes for audience seats
- [ ] Export backup of working state

**1 Day Before:**
- [ ] Test complete show flow
- [ ] Verify audio system connection (if using Ableton)
- [ ] Test projector display and resolution
- [ ] Confirm all phones can connect to network
- [ ] Create fresh backup

**Day Of:**
- [ ] Start server: `npm run dev:network`
- [ ] Open controller on performance laptop
- [ ] Open projector on display system
- [ ] Test one audience connection
- [ ] Keep backup state file accessible

---

## Common Issues

### Issue: Audience can't connect
**Solution:**
- Verify server started with `npm run dev:network`
- Check firewall allows port 3000
- Confirm correct IP address (run `ipconfig getifaddr en0` again)
- Ensure same Wi-Fi network

### Issue: State not syncing
**Solution:**
- Check browser console for WebSocket errors
- Verify Socket.IO connection (green dot in UI)
- Try manual reconnect
- Check server logs for errors

### Issue: Votes not submitting
**Solution:**
- Verify both faction and personal votes selected
- Check current row phase (must be "voting")
- Check network connection
- Inspect browser console for errors

### Issue: Database locked
**Solution:**
- Only one server instance should run at a time
- Stop all running servers: `lsof -ti:3000 | xargs kill`
- Restart server

---

## Automated Testing

### Unit Tests
```bash
# All tests
npm test

# Conductor only (pure logic)
npm run test:conductor

# Watch mode
npm run test:watch
```

### Type Checking
```bash
npm run typecheck
```

All tests should pass before performance!

---

## Debugging Tips

### Enable Verbose Logging
```bash
DEBUG=* npm run dev:network
```

### Socket.IO Debugging
Open browser console and check:
- Connection state: Should show "connected"
- Events: Monitor state_sync, vote, coup_vote events
- Errors: Look for connection or serialization errors

### Database Inspection
```bash
sqlite3 data/yggdrasil.db

# Useful queries:
SELECT * FROM show_state ORDER BY version DESC LIMIT 1;
SELECT * FROM votes;
SELECT * FROM users;
```

---

For issues during development, check:
- Server logs (console output)
- Browser DevTools console
- Network tab for failed requests
- Database state (`data/yggdrasil.db`)
