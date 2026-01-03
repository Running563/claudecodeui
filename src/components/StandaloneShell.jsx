import React, { useState, useCallback, useEffect, forwardRef } from 'react';
import Shell from './Shell.jsx';

/**
 * Generic Shell wrapper that can be used in tabs, modals, and other contexts.
 * Provides a flexible API for both standalone and session-based usage.
 *
 * @param {Object} project - Project object with name, path, displayName
 * @param {Object} session - Session object (optional, for tab usage)
 * @param {string} command - Initial command to run (optional)
 * @param {boolean} isPlainShell - Use plain shell mode vs Claude CLI (default: auto-detect)
 * @param {boolean} autoConnect - Whether to auto-connect when mounted (default: true)
 * @param {boolean} isActive - Whether this shell tab is currently active (triggers first connection)
 * @param {function} onComplete - Callback when process completes (receives exitCode)
 * @param {function} onClose - Callback for close button (optional)
 * @param {string} title - Custom header title (optional)
 * @param {string} className - Additional CSS classes
 * @param {boolean} showHeader - Whether to show custom header (default: true)
 * @param {boolean} compact - Use compact layout (default: false)
 * @param {boolean} minimal - Use minimal mode: no header, no overlays, auto-connect (default: false)
 * @param {function} onShellStateChange - Callback when shell state changes (isConnected, isConnecting, etc.)
 */
const StandaloneShell = forwardRef(function StandaloneShell({
  project,
  session = null,
  command = null,
  isPlainShell = null,
  autoConnect = true,
  isActive = true,
  onComplete = null,
  onClose = null,
  title = null,
  className = "",
  showHeader = true,
  compact = false,
  minimal = false,
  onShellStateChange = null
}, ref) {
  const [isCompleted, setIsCompleted] = useState(false);
  // Track if we've ever been activated for current session - resets when session changes
  const [hasBeenActivated, setHasBeenActivated] = useState(isActive);
  // Track session id to detect session changes
  const [lastSessionId, setLastSessionId] = useState(session?.id);

  const shouldUsePlainShell = isPlainShell !== null ? isPlainShell : (command !== null);

  const handleProcessComplete = useCallback((exitCode) => {
    setIsCompleted(true);
    if (onComplete) {
      onComplete(exitCode);
    }
  }, [onComplete]);

  // Reset hasBeenActivated when session changes - requires user to click shell tab again
  useEffect(() => {
    const currentSessionId = session?.id;
    if (currentSessionId !== lastSessionId) {
      setLastSessionId(currentSessionId);
      setHasBeenActivated(false);
    }
  }, [session?.id, lastSessionId]);

  // Track first activation - only connect on first activation, never disconnect on tab switch
  useEffect(() => {
    if (isActive && !hasBeenActivated) {
      setHasBeenActivated(true);
    }
  }, [isActive, hasBeenActivated]);

  // Compute effective autoConnect: only auto-connect after first activation
  const effectiveAutoConnect = hasBeenActivated && (minimal ? true : autoConnect);

  // Shell can work without a project - will use home directory as default

  return (
    <div className={`h-full w-full flex flex-col ${className}`}>
      {/* Optional custom header */}
      {!minimal && showHeader && title && (
        <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium text-gray-200">{title}</h3>
              {isCompleted && (
                <span className="text-xs text-green-400">(Completed)</span>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white"
                title="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Shell component wrapper */}
      <div className="flex-1 w-full min-h-0">
        <Shell
          ref={ref}
          selectedProject={project || { path: null, displayName: 'Home' }}
          selectedSession={session}
          initialCommand={command}
          isPlainShell={shouldUsePlainShell}
          onProcessComplete={handleProcessComplete}
          minimal={minimal}
          autoConnect={effectiveAutoConnect}
          onShellStateChange={onShellStateChange}
        />
      </div>
    </div>
  );
});

export default StandaloneShell;