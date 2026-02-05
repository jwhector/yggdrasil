'use client';

/**
 * Controller Page
 *
 * Performer's control interface. Provides:
 * - Seat map visualization (lobby)
 * - Faction assignment trigger
 * - Phase advancement
 * - Emergency controls (pause, reset, export/import)
 * - State overview
 */

import { useState, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useShowState } from '@/hooks/useShowState';
import { SeatMap } from '@/components/SeatMap';
import type { ControllerClientState, ShowState } from '@/conductor/types';

// TODO: Get from environment or config
const SHOW_ID = 'default-show';

export default function ControllerPage() {
  const { socket, connectionState, userId, reconnect } = useSocket({
    showId: SHOW_ID,
    mode: 'controller',
  });

  const { state, fullState, sendCommand, isLoading } = useShowState(
    socket,
    'controller',
    userId
  );

  const controllerState = state as ControllerClientState | null;

  // File input ref for import state
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Connection status indicator
  const connectionColor =
    connectionState === 'connected'
      ? '#4ade80'
      : connectionState === 'connecting' || connectionState === 'reconnecting'
      ? '#fbbf24'
      : '#f87171';

  // Phase controls
  const handleAssignFactions = () => {
    sendCommand({ type: 'ASSIGN_FACTIONS' });
  };

  const handleAdvancePhase = () => {
    sendCommand({ type: 'ADVANCE_PHASE' });
  };

  const handleStartShow = () => {
    sendCommand({ type: 'START_SHOW' });
  };

  const handlePause = () => {
    sendCommand({ type: 'PAUSE' });
  };

  const handleResume = () => {
    sendCommand({ type: 'RESUME' });
  };

  const handleSkipRow = () => {
    sendCommand({ type: 'SKIP_ROW' });
  };

  const handleRestartRow = () => {
    sendCommand({ type: 'RESTART_ROW' });
  };

  const handleForceFinal = () => {
    sendCommand({ type: 'FORCE_FINALE' });
  };

  // Emergency controls
  const handleResetToLobby = (preserveUsers: boolean) => {
    sendCommand({ type: 'RESET_TO_LOBBY', preserveUsers });
    setShowResetConfirm(false);
  };

  const handleExportState = () => {
    if (!fullState) return;

    const blob = new Blob([JSON.stringify(fullState, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `show-${fullState.id}-v${fullState.version}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportState = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedState: ShowState = JSON.parse(text);
      sendCommand({ type: 'IMPORT_STATE', state: importedState });
      console.log('[Controller] Imported state:', importedState.id);
    } catch (err) {
      console.error('[Controller] Failed to import state:', err);
      alert('Failed to import state. Check console for details.');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleForceReconnectAll = () => {
    sendCommand({ type: 'FORCE_RECONNECT_ALL' });
  };

  // Helper to determine if controls should be enabled
  const canAssignFactions = controllerState?.showPhase === 'lobby';
  const canStartShow = controllerState?.showPhase === 'assigning';
  const isPaused = controllerState?.showPhase === 'paused';
  const canAdvance = controllerState?.showPhase === 'running';
  const canControl = controllerState?.showPhase === 'running' || isPaused;

  if (isLoading) {
    return (
      <main style={styles.container}>
        <h1>Controller</h1>
        <p style={{ color: '#666' }}>Loading...</p>
      </main>
    );
  }

  return (
    <main style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={{ margin: 0 }}>Yggdrasil Controller</h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
            Show ID: {fullState?.id || 'Unknown'}
          </p>
        </div>
        <div style={styles.statusContainer}>
          <div style={styles.statusDot(connectionColor)} />
          <span style={{ fontSize: '0.875rem' }}>
            {connectionState === 'connected' ? 'Connected' : connectionState}
          </span>
          {connectionState !== 'connected' && (
            <button onClick={reconnect} style={styles.smallButton}>
              Reconnect
            </button>
          )}
        </div>
      </div>

      {/* Seat Map (Lobby Phase Only) */}
      {controllerState && controllerState.showPhase === 'lobby' && fullState && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Seat Map</h2>
          <SeatMap
            users={fullState.users}
            factions={Array.from(fullState.factions)}
            assigned={false}
          />
        </section>
      )}

      {/* Seat Map (Assigning Phase) */}
      {controllerState && controllerState.showPhase === 'assigning' && fullState && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Faction Assignment</h2>
          <SeatMap
            users={fullState.users}
            factions={Array.from(fullState.factions)}
            assigned={true}
          />
        </section>
      )}

      {/* State Overview */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Show State</h2>
        <div style={styles.stateGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Phase</div>
            <div style={styles.statValue}>{controllerState?.showPhase || 'N/A'}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Current Row</div>
            <div style={styles.statValue}>
              {controllerState ? `${controllerState.currentRowIndex + 1}/${controllerState.rows.length}` : 'N/A'}
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Users</div>
            <div style={styles.statValue}>{controllerState?.userCount || 0}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Version</div>
            <div style={styles.statValue}>{fullState?.version || 0}</div>
          </div>
        </div>

        {/* Faction Distribution */}
        {controllerState && controllerState.factionCounts.some((c) => c > 0) && (
          <div style={{ marginTop: '1rem' }}>
            <div style={styles.statLabel}>Faction Distribution</div>
            <div style={styles.factionGrid}>
              {controllerState.factions.map((faction, idx) => (
                <div key={faction.id} style={styles.factionCard}>
                  <div
                    style={{
                      ...styles.factionColor,
                      backgroundColor: faction.color,
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{faction.name}</div>
                    <div style={{ fontSize: '0.875rem', color: '#666' }}>
                      {controllerState.factionCounts[idx]} members
                      {faction.coupUsed && ' · Coup used'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Current Row Info */}
        {controllerState && controllerState.showPhase === 'running' && (
          <div style={{ marginTop: '1rem' }}>
            <div style={styles.statLabel}>Current Row</div>
            <div style={styles.rowCard}>
              <div>
                <strong>{controllerState.rows[controllerState.currentRowIndex]?.label}</strong>
              </div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>
                Phase: {controllerState.rows[controllerState.currentRowIndex]?.phase}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>
                Attempts: {controllerState.rows[controllerState.currentRowIndex]?.attempts + 1}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Phase Controls */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Show Controls</h2>
        <div style={styles.buttonGrid}>
          <button
            onClick={handleAssignFactions}
            disabled={!canAssignFactions}
            style={styles.button}
          >
            Assign Factions
          </button>
          <button
            onClick={handleStartShow}
            disabled={!canStartShow}
            style={styles.button}
          >
            Start Show
          </button>
          <button
            onClick={handleAdvancePhase}
            disabled={!canAdvance}
            style={styles.button}
          >
            Advance Phase
          </button>
          <button
            onClick={isPaused ? handleResume : handlePause}
            disabled={!canControl && !isPaused}
            style={styles.button}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleSkipRow}
            disabled={!canControl}
            style={styles.button}
          >
            Skip Row
          </button>
          <button
            onClick={handleRestartRow}
            disabled={!canControl}
            style={styles.button}
          >
            Restart Row
          </button>
          <button
            onClick={handleForceFinal}
            disabled={!canControl}
            style={styles.button}
          >
            Force Finale
          </button>
        </div>
      </section>

      {/* Emergency Controls */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Emergency Controls</h2>
        {!showResetConfirm ? (
          <div style={styles.buttonGrid}>
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{ ...styles.button, ...styles.dangerButton }}
            >
              Reset to Lobby
            </button>
            <button onClick={handleExportState} style={styles.button}>
              Export State
            </button>
            <button onClick={handleImportState} style={styles.button}>
              Import State
            </button>
            <button onClick={handleForceReconnectAll} style={styles.button}>
              Force Reconnect All
            </button>
          </div>
        ) : (
          <div style={styles.confirmBox}>
            <p style={{ margin: '0 0 1rem 0' }}>
              Are you sure you want to reset to lobby?
            </p>
            <div style={styles.buttonGrid}>
              <button
                onClick={() => handleResetToLobby(true)}
                style={{ ...styles.button, ...styles.dangerButton }}
              >
                Reset (Keep Users)
              </button>
              <button
                onClick={() => handleResetToLobby(false)}
                style={{ ...styles.button, ...styles.dangerButton }}
              >
                Reset (Clear All)
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={styles.button}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Paths Display */}
      {controllerState && controllerState.paths.factionPath.length > 0 && (
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Paths</h2>
          <div style={styles.pathGrid}>
            <div>
              <div style={styles.statLabel}>Faction Path</div>
              <div style={styles.pathDisplay}>
                {controllerState.paths.factionPath.join(' → ')}
              </div>
            </div>
            <div>
              <div style={styles.statLabel}>Popular Path</div>
              <div style={styles.pathDisplay}>
                {controllerState.paths.popularPath.join(' → ')}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />
    </main>
  );
}

// Styles
const styles = {
  container: {
    padding: '2rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '1200px',
    margin: '0 auto',
    minHeight: '100vh',
  } as React.CSSProperties,

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid #e5e5e5',
  } as React.CSSProperties,

  statusContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  } as React.CSSProperties,

  statusDot: (color: string) =>
    ({
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      backgroundColor: color,
    } as React.CSSProperties),

  section: {
    marginBottom: '2rem',
    padding: '1.5rem',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  sectionTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1.25rem',
    fontWeight: 600,
  } as React.CSSProperties,

  stateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
  } as React.CSSProperties,

  statCard: {
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  statLabel: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: '0.25rem',
  } as React.CSSProperties,

  statValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#111',
  } as React.CSSProperties,

  factionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '0.75rem',
    marginTop: '0.5rem',
  } as React.CSSProperties,

  factionCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
  } as React.CSSProperties,

  factionColor: {
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    flexShrink: 0,
  } as React.CSSProperties,

  rowCard: {
    padding: '1rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
    marginTop: '0.5rem',
  } as React.CSSProperties,

  buttonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '0.75rem',
  } as React.CSSProperties,

  button: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    backgroundColor: '#111',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  } as React.CSSProperties,

  dangerButton: {
    backgroundColor: '#dc2626',
  } as React.CSSProperties,

  smallButton: {
    padding: '0.25rem 0.5rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    backgroundColor: '#111',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  } as React.CSSProperties,

  confirmBox: {
    padding: '1rem',
    backgroundColor: '#fef2f2',
    borderRadius: '6px',
    border: '1px solid #fecaca',
  } as React.CSSProperties,

  pathGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem',
  } as React.CSSProperties,

  pathDisplay: {
    padding: '0.75rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    border: '1px solid #e5e5e5',
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    marginTop: '0.5rem',
  } as React.CSSProperties,
};
