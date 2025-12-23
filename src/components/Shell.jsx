import React, { useEffect, useRef, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
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
  /* Mobile scroll optimization */
  .xterm .xterm-viewport {
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scroll-behavior: auto !important;
  }
  /* Improve mobile touch scrolling */
  @media (max-width: 767px) {
    .xterm .xterm-viewport {
      overflow-y: auto !important;
      touch-action: pan-y !important;
    }
    .xterm .xterm-screen {
      touch-action: pan-y !important;
    }
    /* Hide native scrollbar on mobile */
    .shell-scroll-container::-webkit-scrollbar {
      display: none;
    }
    .shell-scroll-container {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  }
`;

// Vertical scrollbar for mobile terminal (controls xterm viewport)
const VerticalScrollBar = ({ viewportElement, topOffset = 0, bottomOffset = 108 }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);
  const [scrollHeight, setScrollHeight] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef(null);
  const dragStartRef = useRef({ y: 0, scrollTop: 0 });
  
  useEffect(() => {
    if (!viewportElement) return;
    
    const updateDimensions = () => {
      const max = viewportElement.scrollHeight - viewportElement.clientHeight;
      setMaxScroll(max > 0 ? max : 0);
      setClientHeight(viewportElement.clientHeight);
      setScrollHeight(viewportElement.scrollHeight);
    };
    
    updateDimensions();
    
    const handleScroll = () => {
      setScrollTop(viewportElement.scrollTop);
    };
    
    viewportElement.addEventListener('scroll', handleScroll);
    
    // Use MutationObserver to detect content changes
    const mutationObserver = new MutationObserver(updateDimensions);
    mutationObserver.observe(viewportElement, { childList: true, subtree: true, characterData: true });
    
    // Also update periodically for terminal output
    const interval = setInterval(updateDimensions, 500);
    
    return () => {
      viewportElement.removeEventListener('scroll', handleScroll);
      mutationObserver.disconnect();
      clearInterval(interval);
    };
  }, [viewportElement]);

  // Calculate thumb height and position
  const thumbHeight = scrollHeight > 0 ? Math.max((clientHeight / scrollHeight) * 100, 8) : 100;
  const thumbPosition = maxScroll > 0 ? (scrollTop / maxScroll) * (100 - thumbHeight) : 0;

  const handleTrackClick = (e) => {
    if (!trackRef.current || !viewportElement) return;
    
    const track = trackRef.current;
    const rect = track.getBoundingClientRect();
    const clickPosition = (e.clientY - rect.top) / rect.height;
    const newScrollTop = clickPosition * maxScroll;
    
    viewportElement.scrollTo({
      top: newScrollTop,
      behavior: 'smooth'
    });
  };

  const handleThumbMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      y: e.clientY,
      scrollTop: viewportElement?.scrollTop || 0
    };
  };

  const handleThumbTouchStart = (e) => {
    e.stopPropagation();
    setIsDragging(true);
    const touch = e.touches[0];
    dragStartRef.current = {
      y: touch.clientY,
      scrollTop: viewportElement?.scrollTop || 0
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!trackRef.current || !viewportElement) return;
      
      const trackHeight = trackRef.current.getBoundingClientRect().height;
      const deltaY = e.clientY - dragStartRef.current.y;
      const scrollDelta = (deltaY / trackHeight) * scrollHeight;
      
      viewportElement.scrollTop = dragStartRef.current.scrollTop + scrollDelta;
    };

    const handleTouchMove = (e) => {
      if (!trackRef.current || !viewportElement) return;
      
      const touch = e.touches[0];
      const trackHeight = trackRef.current.getBoundingClientRect().height;
      const deltaY = touch.clientY - dragStartRef.current.y;
      const scrollDelta = (deltaY / trackHeight) * scrollHeight;
      
      viewportElement.scrollTop = dragStartRef.current.scrollTop + scrollDelta;
    };

    const handleMouseUp = () => setIsDragging(false);
    const handleTouchEnd = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, scrollHeight, viewportElement]);
  
  if (!viewportElement) return null;
  
  return (
    <div 
      className="absolute flex items-center justify-center"
      style={{ 
        zIndex: 30,
        top: `${topOffset}px`,
        bottom: `${bottomOffset}px`,
        right: 0,
        width: '15px',
      }}
    >
      <div 
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-full cursor-pointer"
        style={{ 
          touchAction: 'none',
          width: '15px',
          backgroundColor: 'rgba(55, 65, 81, 0.8)',
        }}
      >
        {/* Scrollbar thumb */}
        <div
          onMouseDown={handleThumbMouseDown}
          onTouchStart={handleThumbTouchStart}
          className="absolute transition-colors duration-150"
          style={{
            height: `${Math.max(thumbHeight, 10)}%`,
            top: `${thumbPosition}%`,
            cursor: 'grab',
            touchAction: 'none',
            minHeight: '48px',
            left: '2px',
            right: '2px',
            backgroundColor: isDragging 
              ? 'rgba(96, 165, 250, 1)' 
              : 'rgba(156, 163, 175, 0.9)',
            boxShadow: isDragging ? '0 0 8px rgba(96, 165, 250, 0.5)' : 'none',
          }}
        />
      </div>
    </div>
  );
};

// Horizontal scrollbar for mobile terminal
const HorizontalScrollBar = ({ scrollContainerRef, terminalWidth }) => {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef(null);
  const dragStartRef = useRef({ x: 0, scrollLeft: 0 });
  
  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    
    const updateDimensions = () => {
      const max = container.scrollWidth - container.clientWidth;
      setMaxScroll(max > 0 ? max : 0);
      setClientWidth(container.clientWidth);
      setContentWidth(container.scrollWidth);
    };
    
    updateDimensions();
    
    const handleScroll = () => {
      setScrollLeft(container.scrollLeft);
    };
    
    container.addEventListener('scroll', handleScroll);
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [scrollContainerRef, terminalWidth]);

  // Calculate thumb width and position
  const thumbWidth = contentWidth > 0 ? Math.max((clientWidth / contentWidth) * 100, 10) : 100;
  const thumbPosition = maxScroll > 0 ? (scrollLeft / maxScroll) * (100 - thumbWidth) : 0;

  const handleTrackClick = (e) => {
    if (!trackRef.current || !scrollContainerRef?.current) return;
    
    const track = trackRef.current;
    const rect = track.getBoundingClientRect();
    const clickPosition = (e.clientX - rect.left) / rect.width;
    const newScrollLeft = clickPosition * maxScroll;
    
    scrollContainerRef.current.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    });
  };

  const handleThumbMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      scrollLeft: scrollContainerRef?.current?.scrollLeft || 0
    };
  };

  const handleThumbTouchStart = (e) => {
    e.stopPropagation();
    setIsDragging(true);
    const touch = e.touches[0];
    dragStartRef.current = {
      x: touch.clientX,
      scrollLeft: scrollContainerRef?.current?.scrollLeft || 0
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      if (!trackRef.current || !scrollContainerRef?.current) return;
      
      const trackWidth = trackRef.current.getBoundingClientRect().width;
      const deltaX = e.clientX - dragStartRef.current.x;
      const scrollDelta = (deltaX / trackWidth) * contentWidth;
      
      scrollContainerRef.current.scrollLeft = dragStartRef.current.scrollLeft + scrollDelta;
    };

    const handleTouchMove = (e) => {
      if (!trackRef.current || !scrollContainerRef?.current) return;
      
      const touch = e.touches[0];
      const trackWidth = trackRef.current.getBoundingClientRect().width;
      const deltaX = touch.clientX - dragStartRef.current.x;
      const scrollDelta = (deltaX / trackWidth) * contentWidth;
      
      scrollContainerRef.current.scrollLeft = dragStartRef.current.scrollLeft + scrollDelta;
    };

    const handleMouseUp = () => setIsDragging(false);
    const handleTouchEnd = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, contentWidth, scrollContainerRef]);
  
  if (maxScroll <= 0) return null;
  
  return (
    <div 
      className="flex-shrink-0 flex items-center"
      style={{
        height: '20px',
        paddingLeft: '0',
        paddingRight: '15px',
        paddingTop: '4px',
        paddingBottom: '4px',
        backgroundColor: 'transparent',
      }}
    >
      <div 
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative w-full cursor-pointer"
        style={{ 
          touchAction: 'none',
          height: '12px',
          backgroundColor: 'rgba(55, 65, 81, 0.8)',
        }}
      >
        {/* Scrollbar thumb */}
        <div
          onMouseDown={handleThumbMouseDown}
          onTouchStart={handleThumbTouchStart}
          className="absolute transition-colors duration-150"
          style={{
            width: `${Math.max(thumbWidth, 10)}%`,
            left: `${thumbPosition}%`,
            cursor: 'grab',
            touchAction: 'none',
            minWidth: '48px',
            top: '2px',
            bottom: '2px',
            backgroundColor: isDragging 
              ? 'rgba(96, 165, 250, 1)' 
              : 'rgba(156, 163, 175, 0.9)',
            boxShadow: isDragging ? '0 0 8px rgba(96, 165, 250, 0.5)' : 'none',
          }}
        />
      </div>
    </div>
  );
};

// Virtual keyboard for mobile devices
const VirtualKeyboard = ({ onKeyPress, onKeyPressWithEnter, isConnected, isQuickTerminal }) => {
  const [pressedKey, setPressedKey] = useState(null);

  if (!isConnected) return null;

  // Different key layouts for AI session vs quick terminal
  const keys = isQuickTerminal ? [
    // Quick Terminal: Basic navigation + clear screen
    { label: 'ESC', key: '\x1b' },
    { label: 'Tab', key: '\t' },
    { label: '↑', key: '\x1b[A' },
    { label: '↓', key: '\x1b[B' },
    { label: '←', key: '\x1b[D' },
    { label: '→', key: '\x1b[C' },
    { label: 'Home', key: '\x1b[H' },
    { label: 'End', key: '\x1b[F' },
    { label: 'Del', key: '\x1b[3~' },
    { label: '⌫', key: '\x7f' }, // Backspace
    { label: 'Enter', key: '\r' },
    { label: 'Clear', key: 'clear', withEnter: true },
  ] : [
    // AI Session: Full keyboard with AI commands
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

function Shell({ selectedProject, selectedSession, initialCommand, isPlainShell = false, onProcessComplete, minimal = false, autoConnect = false, onShellStateChange }, ref) {
  const terminalRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const terminal = useRef(null);
  const fitAddon = useRef(null);
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userDisconnected, setUserDisconnected] = useState(false);
  
  // Track if device is mobile for terminal optimizations
  const isMobileDevice = useRef(window.innerWidth < 768);
  
  // Check if this is a quick terminal (not AI session)
  const isQuickTerminal = selectedSession?.provider === 'quick-terminal' || selectedSession?.__provider === 'quick-terminal';
  
  // Viewport ref for vertical scrollbar - use state to trigger re-render
  const [viewportElement, setViewportElement] = useState(null);

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
                : (selectedSessionRef.current?.provider || selectedSessionRef.current?.__provider || localStorage.getItem('selected-provider') || 'claude');

              console.log('[Shell] Sending init:', cols, 'x', rows, 'provider:', provider);

              ws.current.send(JSON.stringify({
                type: 'init',
                projectPath: selectedProjectRef.current.path || selectedProjectRef.current.path,
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
    setUserDisconnected(false);
    setIsConnecting(true);
    connectWebSocket();
  }, [isInitialized, isConnected, isConnecting, connectWebSocket]);

  const disconnectFromShell = useCallback(() => {
    setUserDisconnected(true);
    
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      // Send disconnect message to server to kill PTY and remove from cache
      ws.current.send(JSON.stringify({
        type: 'disconnect'
      }));
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
    const sessionProvider = selectedSession.provider || selectedSession.__provider;
    return sessionProvider === 'cursor' || sessionProvider === 'codebuddy'
      ? (selectedSession.name || '无标题会话')
      : (selectedSession.summary || '新会话');
  }, [selectedSession]);

  const sessionDisplayNameShort = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 30);
  }, [sessionDisplayName]);

  const sessionDisplayNameLong = useMemo(() => {
    if (!sessionDisplayName) return null;
    return sessionDisplayName.slice(0, 50);
  }, [sessionDisplayName]);

  const restartShell = useCallback(() => {
    setIsRestarting(true);
    setUserDisconnected(false);

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
  }, []);

  // Expose shell control methods and state via ref
  useImperativeHandle(ref, () => ({
    connect: connectToShell,
    disconnect: disconnectFromShell,
    restart: restartShell,
    isConnected,
    isConnecting,
    isInitialized,
    isRestarting
  }), [connectToShell, disconnectFromShell, restartShell, isConnected, isConnecting, isInitialized, isRestarting]);

  // Notify parent of state changes
  useEffect(() => {
    if (onShellStateChange) {
      onShellStateChange({
        isConnected,
        isConnecting,
        isInitialized,
        isRestarting,
        sessionDisplayNameShort
      });
    }
  }, [isConnected, isConnecting, isInitialized, isRestarting, sessionDisplayNameShort, onShellStateChange]);

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
    const scrollbackSize = isMobile ? 1000 : 10000;

    const terminalOptions = {
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
    };
    
    // Add mobile-specific options
    if (isMobile) {
      terminalOptions.smoothScrollDuration = 0;
      terminalOptions.fastScrollSensitivity = 3;
      terminalOptions.cols = 100;
      terminalOptions.scrollSensitivity = 3;
    } else {
      terminalOptions.fastScrollModifier = 'alt';
      terminalOptions.fastScrollSensitivity = 5;
    }
    
    terminal.current = new Terminal(terminalOptions);
    
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
    
    // Store viewport ref for vertical scrollbar
    if (isMobile) {
      setTimeout(() => {
        const viewport = terminalRef.current?.querySelector('.xterm-viewport');
        if (viewport) {
          setViewportElement(viewport);
        }
      }, 200);
    }
    
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
      
      setViewportElement(null);

      if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        ws.current.close();
      }
      ws.current = null;

      if (terminal.current) {
        terminal.current.dispose();
        terminal.current = null;
      }
    };
  }, [selectedProject?.path || selectedProject?.path, isRestarting]);

  useEffect(() => {
    if (!autoConnect || !isInitialized || isConnecting || isConnected || userDisconnected) return;
    connectToShell();
  }, [autoConnect, isInitialized, isConnecting, isConnected, userDisconnected, connectToShell]);

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">选择项目</h3>
          <p>选择一个项目以在该目录中打开交互式终端</p>
        </div>
      </div>
    );
  }

  if (minimal) {
    const isMobile = isMobileDevice.current;
    // Calculate terminal width: 100 cols * 6.6px per char (approximate for 11px font)
    const terminalWidth = isMobile ? 100 * 6.6 : '100%';
    
    return (
      <div className="h-full w-full bg-gray-900 flex flex-col relative">
        <div 
          ref={scrollContainerRef}
          className={`flex-1 relative min-h-0 shell-scroll-container ${isMobile ? 'overflow-x-auto' : 'overflow-auto'}`}
          style={isMobile ? { touchAction: 'pan-x', marginRight: '15px' } : undefined}
        >
          <div 
            ref={terminalRef} 
            className="focus:outline-none absolute inset-0" 
            style={{ 
              outline: 'none',
              width: typeof terminalWidth === 'number' ? `${terminalWidth}px` : '100%',
              touchAction: isMobile ? 'pan-y' : 'auto'
            }} 
          />
        </div>
        {isMobile && (
          <>
            <HorizontalScrollBar scrollContainerRef={scrollContainerRef} terminalWidth={terminalWidth} />
            <VirtualKeyboard onKeyPress={handleVirtualKeyPress} onKeyPressWithEnter={handleVirtualKeyPressWithEnter} isConnected={isConnected} isQuickTerminal={isQuickTerminal} />
          </>
        )}
        {isMobile && <VerticalScrollBar viewportElement={viewportElement} topOffset={0} bottomOffset={64} />}
      </div>
    );
  }

  const isMobile = isMobileDevice.current;
  const terminalWidth = isMobile ? 100 * 6.6 : '100%';

  return (
    <div className="h-full flex flex-col bg-gray-900 w-full relative">
      {/* Desktop toolbar - hidden on mobile since controls are in MainContent header */}
      {!isMobile && (
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
                <span className="text-xs text-gray-400">(新会话)</span>
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
                  title="与终端断开连接"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>断开连接</span>
                </button>
              )}

              <button
                onClick={restartShell}
                disabled={isRestarting || isConnected}
                className="text-xs text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                title="重启终端（先断开）"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9M11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Restart</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div 
        ref={scrollContainerRef}
        className={`flex-1 relative min-h-0 shell-scroll-container ${isMobile ? 'overflow-x-auto' : 'overflow-auto'}`} 
        style={{ ...(isMobile ? { touchAction: 'pan-x', marginRight: '15px' } : { padding: '0.5rem' }) }}
      >
        <div 
          ref={terminalRef} 
          className="focus:outline-none absolute inset-0" 
          style={{ 
            outline: 'none',
            width: typeof terminalWidth === 'number' ? `${terminalWidth}px` : '100%',
            margin: isMobile ? 0 : '0.5rem',
            touchAction: isMobile ? 'pan-y' : 'auto'
          }} 
        />

        {!isInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
            <div className="text-white">加载终端...</div>
          </div>
        )}

        {isInitialized && !isConnected && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
            <div className="text-center max-w-sm w-full">
              <button
                onClick={connectToShell}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full sm:w-auto mx-auto"
                title="Connect to shell"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>在终端中继续</span>
              </button>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `在 ${selectedProject.displayName} 中运行 ${initialCommand || '命令'}` :
                  selectedSession ?
                    `恢复会话: ${sessionDisplayNameLong}...` :
                    '开始新的 Claude 会话'
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
                <span className="text-base font-medium">连接到终端...</span>
              </div>
              <p className="text-gray-400 text-sm mt-3 px-2">
                {isPlainShell ?
                  `在 ${selectedProject.displayName} 中运行 ${initialCommand || '命令'}` :
                  `在 ${selectedProject.displayName} 中启动 Claude CLI`
                }
              </p>
            </div>
          </div>
        )}
      </div>

      {isMobile && (
        <>
          <HorizontalScrollBar scrollContainerRef={scrollContainerRef} terminalWidth={terminalWidth} />
          <VirtualKeyboard onKeyPress={handleVirtualKeyPress} onKeyPressWithEnter={handleVirtualKeyPressWithEnter} isConnected={isConnected} isQuickTerminal={isQuickTerminal} />
        </>
      )}
      {isMobile && <VerticalScrollBar viewportElement={viewportElement} topOffset={0} bottomOffset={64} />}
    </div>
  );
}

export default forwardRef(Shell);