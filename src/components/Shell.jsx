import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const xtermStyles = `
  .xterm .xterm-screen {
    outline: none !important;
  }
  .xterm:focus .xterm-screen {
    outline: none !important;
  }
  .xterm-screen:focus {
    outline: none !important;
  }
`;

// Virtual keyboard for mobile devices
const VirtualKeyboard = ({ onKeyPress, onKeyPressWithEnter, isConnected }) => {
  const [pressedKey, setPressedKey] = useState(null);

  if (!isConnected) return null;

  const keys = [
    { label: 'ESC', key: '\x1b' },
    { label: 'Tab', key: '\t' },
    { label: 'S+Tab', key: '\x1b[Z' },
    { label: '↑', key: '\x1b[A' },
    { label: '↓', key: '\x1b[B' },
    { label: '←', key: '\x1b[D' },
    { label: '→', key: '\x1b[C' },
    { label: 'Enter', key: '\r' },
    { label: '/clear', key: '/clear', withEnter: true },
    { label: '/model', key: '/model', withEnter: true },
    { label: 'Ctrl+C', key: '\x03' },
    { label: 'Ctrl+D', key: '\x04' },
  ];

  return (
    <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-2 py-2 overflow-x-auto">
      <div className="flex gap-1.5 min-w-max">
        {keys.map((k) => (
          <button
            key={k.label}
            type="button"
            onTouchStart={() => setPressedKey(k.label)}
            onTouchEnd={(e) => {
              e.preventDefault();
              setPressedKey(null);
              if (k.withEnter) {
                onKeyPressWithEnter(k.key);
              } else {
                onKeyPress(k.key);
              }
            }}
            onTouchCancel={() => setPressedKey(null)}
            className="vk-btn px-3 py-2 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
            style={{ 
              minWidth: '40px',
              WebkitTapHighlightColor: 'transparent',
              backgroundColor: pressedKey === k.label ? '#4b5563' : '#374151',
              color: '#fff',
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
};

if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = xtermStyles;
  document.head.appendChild(styleSheet);
}

function Shell({ selectedProject, selectedSession, initialCommand, isPlainShell = false, onProcessComplete, minimal = false, autoConnect = false }) {
  const terminalRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Track if device is mobile for terminal optimizations
  const isMobileDevice = useRef(window.innerWidth < 768);

  const selectedProjectRef = useRef(selectedProject);
  const selectedSessionRef = useRef(selectedSession);
  const initialCommandRef = useRef(initialCommand);
  const isPlainShellRef = useRef(isPlainShell);
  const onProcessCompleteRef = useRef(onProcessComplete);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
    selectedSessionRef.current = selectedSession;
    initialCommandRef.current = initialCommand;
    isPlainShellRef.current = isPlainShell;
    onProcessCompleteRef.current = onProcessComplete;
  });

  // Update mobile detection on window resize
  useEffect(() => {
    const handleResize = () => {
      isMobileDevice.current = window.innerWidth < 768;
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const connectWebSocket = useCallback(async () => {
    if (isConnecting || isConnected) return;

    try {
      const isPlatform = import.meta.env.VITE_IS_PLATFORM === 'true';
      let wsUrl;

      if (isPlatform) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/shell`;
      } else {
        const token = localStorage.getItem('auth-token');
        if (!token) {
          console.error('No authentication token found for Shell WebSocket connection');
          return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/shell?token=${encodeURIComponent(token)}`;
      }

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);

        setTimeout(() => {
          if (terminal.current && fitAddon.current) {
            const isMobile = isMobileDevice.current;
            
            // On mobile, use fit to calculate rows, then force cols to 120
            // On desktop, use fit addon to calculate optimal dimensions
            if (isMobile) {
              try {
                fitAddon.current.fit();
                const fittedRows = terminal.current.rows;
                terminal.current.resize(100, fittedRows);
              } catch (error) {
                console.error('[Shell] Error resizing terminal:', error);
                terminal.current.resize(100, 40);
              }
            } else {
              fitAddon.current.fit();
            }
            
            setTimeout(() => {
              const cols = terminal.current.cols;
              const rows = terminal.current.rows;

              const provider = isPlainShellRef.current 
                ? 'plain-shell' 
                : (selectedSessionRef.current?.__provider || localStorage.getItem('selected-provider') || 'claude');

              console.log('[Shell] Sending init:', cols, 'x', rows, 'provider:', provider);

              ws.current.send(JSON.stringify({
                type: 'init',
                projectPath: selectedProjectRef.current.fullPath || selectedProjectRef.current.path,
                sessionId: isPlainShellRef.current ? null : selectedSessionRef.current?.id,
                hasSession: isPlainShellRef.current ? false : !!selectedSessionRef.current,
                provider: provider,
                cols: cols,
                rows: rows,
                initialCommand: initialCommandRef.current,
                isPlainShell: isPlainShellRef.current
              }));
            }, 50);
          }
        }, 100);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'output') {
            let output = data.data;

            if (isPlainShellRef.current && onProcessCompleteRef.current) {
              const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
              if (cleanOutput.includes('Process exited with code 0')) {
                onProcessCompleteRef.current(0);
              } else if (cleanOutput.match(/Process exited with code (\d+)/)) {
                const exitCode = parseInt(cleanOutput.match(/Process exited with code (\d+)/)[1]);
                if (exitCode !== 0) {
                  onProcessCompleteRef.current(exitCode);
                }
              }
            }

            if (terminal.current) {
              terminal.current.write(output);
            }
          } else if (data.type === 'url_open') {
            window.open(data.url, '_blank');
          }
        } catch (error) {
          console.error('[Shell] Error handling WebSocket message:', error, event.data);
        }
      };

      ws.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);

        if (terminal.current) {
          terminal.current.clear();
          terminal.current.write('\x1b[2J\x1b[H');
        }
      };

      ws.current.onerror = (error) => {
        setIsConnected(false);
        setIsConnecting(false);
      };
    } catch (error) {
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected]);

  const connectToShell = useCallback(() => {
    if (!isInitialized || isConnected || isConnecting) return;
    setIsConnecting(true);
    connectWebSocket();
  }, [isInitialized, isConnected, isConnecting, connectWebSocket]);

  const disconnectFromShell = useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    if (terminal.current) {
      terminal.current.clear();
      terminal.current.write('\x1b[2J\x1b[H');
    }

    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  // Virtual keyboard key press handler
  const handleVirtualKeyPress = useCallback((key) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'input',
        data: key
      }));
    }
    // On mobile, don't focus terminal to avoid triggering system keyboard
    // The virtual keyboard handles input instead
  }, []);

  // Virtual keyboard key press with Enter (sends text, then Enter after 100ms)
  const handleVirtualKeyPressWithEnter = useCallback((key) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'input',
        data: key
      }));
      setTimeout(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'input',
            data: '\r'
          }));
        }
      }, 100);
    }
  }, []);


  const sessionDisplayName = useMemo(() => {
    if (!selectedSession) return null;
    return selectedSession.__provider === 'cursor'
      ? (selectedSession.name || 'Untitled Session')
      : (selectedSession.summary || 'New Session');
  }, [selectedSession]);

  const sessionDisplayNameShort = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 30);
  }, [sessionDisplayName]);

  const sessionDisplayNameLong = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 50);
  }, [sessionDisplayName]);

  const restartShell = () => {
    setIsRestarting(true);

    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    if (terminal.current) {
      terminal.current.dispose();
      terminal.current = null;
      fitAddon.current = null;
    }

    setIsConnected(false);
    setIsInitialized(false);

    setTimeout(() => {
      setIsRestarting(false);
    }, 200);
  };

  useEffect(() => {
    const currentSessionId = selectedSession?.id || null;

    if (lastSessionId !== null && lastSessionId !== currentSessionId && isInitialized) {
      disconnectFromShell();
    }

    setLastSessionId(currentSessionId);
  }, [selectedSession?.id, isInitialized, disconnectFromShell]);

  useEffect(() => {
    if (!terminalRef.current || !selectedProject || isRestarting || terminal.current) {
      return;
    }

    const isMobile = isMobileDevice.current;
    const scrollbackSize = isMobile ? 2000 : 10000;

    terminal.current = new Terminal({
      cursorBlink: true,
      fontSize: isMobile ? 11 : 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: true,
      scrollback: scrollbackSize,
      tabStopWidth: 4,
      windowsMode: false,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: false,
      smoothScrollDuration: isMobile ? 0 : undefined,
      fastScrollModifier: isMobile ? undefined : 'alt',
      fastScrollSensitivity: isMobile ? 1 : 5,
      // Mobile: 100 cols (enough for code, minimal horizontal scroll)
      cols: isMobile ? 100 : undefined,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selection: '#264f78',
        selectionForeground: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
        extendedAnsi: [
          '#000000', '#800000', '#008000', '#808000',
          '#000080', '#800080', '#008080', '#c0c0c0',
          '#808080', '#ff0000', '#00ff00', '#ffff00',
          '#0000ff', '#ff00ff', '#00ffff', '#ffffff'
        ]
      }
    });
    
    fitAddon.current = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(webLinksAddon);

    // Only use WebGL on desktop for better performance
    if (!isMobile) {
      try {
        const webglAddon = new WebglAddon();
        terminal.current.loadAddon(webglAddon);
      } catch (error) {
        console.warn('[Shell] WebGL unavailable, using Canvas fallback');
      }
    }
    
    try {
      terminal.current.open(terminalRef.current);
      
      // Initial fit for desktop
      setTimeout(() => {
        if (fitAddon.current && !isMobile) {
          try {
            fitAddon.current.fit();
          } catch (fitError) {
            console.error('[Shell] Error fitting terminal:', fitError);
          }
        }
      }, 150);
    } catch (error) {
      console.error('[Shell] Error opening terminal:', error);
    }

    terminal.current.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'c' && terminal.current.hasSelection()) {
        document.execCommand('copy');
        return false;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        navigator.clipboard.readText().then(text => {
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'input',
              data: text
            }));
          }
        }).catch(() => {});
        return false;
      }

      return true;
    });

    // Desktop resize handling
    setTimeout(() => {
      if (fitAddon.current && !isMobile) {
        try {
          fitAddon.current.fit();
          if (terminal.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              type: 'resize',
              cols: terminal.current.cols,
              rows: terminal.current.rows
            }));
          }
        } catch (error) {
          console.error('[Shell] Error in resize:', error);
        }
      }
    }, 100);

    setIsInitialized(true);
    
    terminal.current.onData((data) => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'input',
          data: data
        }));
      }
    });

    // ResizeObserver for desktop only
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && terminal.current && !isMobile) {
        setTimeout(() => {
          try {
            fitAddon.current.fit();
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify({
                type: 'resize',
                cols: terminal.current.cols,
                rows: terminal.current.rows
              }));
            }
          } catch (error) {
            console.error('[Shell] ResizeObserver error:', error);
          }
        }, 50);
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();

      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        ws.current.close();
      }
      ws.current = null;

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    };
  }, [selectedProject?.path || selectedProject?.fullPath, isRestarting]);

  useEffect(() => {
    if (!autoConnect || !isInitialized || isConnecting || isConnected) return;
    connectToShell();
  }, [autoConnect, isInitialized, isConnecting, isConnected, connectToShell]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Select a Project</h3>
          <p>Choose a project to open an interactive shell in that directory</p>
        </div>
      </div>
    );
  }

  if (minimal) {
    const isMobile = isMobileDevice.current;
    // Calculate terminal width: 100 cols * 6.6px per char (approximate for 11px font)
    const terminalWidth = isMobile ? 100 * 6.6 : '100%';
    
    return (
      <div className="h-full w-full bg-gray-900 flex flex-col">
        <div className="flex-1 overflow-auto relative min-h-0">
          <div 
            ref={terminalRef} 
            className="focus:outline-none absolute inset-0" 
            style={{ 
              outline: 'none',
              width: typeof terminalWidth === 'number' ? `${terminalWidth}px` : '100%'
            }} 
          />
        </div>
        {isMobile && (
          <VirtualKeyboard onKeyPress={handleVirtualKeyPress} onKeyPressWithEnter={handleVirtualKeyPressWithEnter} isConnected={isConnected} />
        )}
      </div>
    );
  }

  const isMobile = isMobileDevice.current;
  const terminalWidth = isMobile ? 100 * 6.6 : '100%';

  return (
    <div className="h-full flex flex-col bg-gray-900 w-full">
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {selectedSession && (
              <span className="text-xs text-blue-300">
                ({sessionDisplayNameShort}...)
              </span>
            )}
            {!selectedSession && (
              <span className="text-xs text-gray-400">(New Session)</span>
            )}
            {!isInitialized && (
              <span className="text-xs text-yellow-400">(Initializing...)</span>
            )}
            {isRestarting && (
              <span className="text-xs text-blue-400">(Restarting...)</span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {isConnected && (
              <button
                onClick={disconnectFromShell}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-1"
                title="Disconnect from shell"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Disconnect</span>
              </button>
            )}

            <button
              onClick={restartShell}
              disabled={isRestarting || isConnected}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
              title="Restart Shell (disconnect first)"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Restart</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative min-h-0" style={{ padding: '0.5rem' }}>
        <div 
          ref={terminalRef} 
          className="focus:outline-none absolute inset-0" 
          style={{ 
            outline: 'none',
            width: typeof terminalWidth === 'number' ? `${terminalWidth}px` : '100%',
            margin: '0.5rem'
          }} 
        />

        {!isInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
            <div className="text-white">Loading terminal...</div>
          </div>
        )}

        {isInitialized && !isConnected && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <button
                onClick={connectToShell}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full sm:w-auto"
                title="Connect to shell"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Continue in Shell</span>
              </button>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `Run ${initialCommand || 'command'} in ${selectedProject.displayName}` :
                  selectedSession ?
                    `Resume session: ${sessionDisplayNameLong}...` :
                    'Start a new Claude session'
                }
              </p>
            </div>
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <div className="flex items-center justify-center space-x-3 text-yellow-400">
                <div className="w-6 h-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
                <span className="text-base font-medium">Connecting to shell...</span>
              </div>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `Running ${initialCommand || 'command'} in ${selectedProject.displayName}` :
                  `Starting Claude CLI in ${selectedProject.displayName}`
                }
              </p>
            </div>
          </div>
        )}
      </div>

      {isMobile && (
        <VirtualKeyboard onKeyPress={handleVirtualKeyPress} onKeyPressWithEnter={handleVirtualKeyPressWithEnter} isConnected={isConnected} />
      )}
    </div>
  );
}

export default Shell;