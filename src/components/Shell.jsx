import React, { useEffect, useRef, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
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
  @media (max-width: 767px) {
    .xterm .xterm-viewport {
      overflow-y: auto !important;
      touch-action: pan-y !important;
    }
    .xterm .xterm-screen {
      touch-action: pan-y !important;
    }
    .shell-scroll-container::-webkit-scrollbar {
      display: none;
    }
    .shell-scroll-container {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    /* 移动端 xterm 滚动条样式 - 更宽更明显 */
    .xterm .xterm-viewport::-webkit-scrollbar {
      width: 8px;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-track {
      background: rgba(30, 30, 30, 0.5);
      border-radius: 4px;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-thumb {
      background: rgba(100, 116, 139, 0.8);
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .xterm .xterm-viewport::-webkit-scrollbar-thumb:active {
      background: rgba(148, 163, 184, 0.9);
    }
  }
`;

// Virtual keyboard for mobile devices
const VirtualKeyboard = ({ 
  onKeyPress, 
  onKeyPressWithEnter, 
  isConnected, 
  isQuickTerminal,
  inputMode,
  onToggleInput,
  selectMode,
  onToggleSelect
}) => {
  const [pressedKey, setPressedKey] = useState(null);

  if (!isConnected) return null;

  // All keys in one array - will auto wrap if needed
  const allKeys = isQuickTerminal ? [
    { label: 'ESC', key: '\x1b' },
    { label: 'Tab', key: '\t' },
    { label: '↑', key: '\x1b[A' },
    { label: '↓', key: '\x1b[B' },
    { label: '←', key: '\x1b[D' },
    { label: '→', key: '\x1b[C' },
    { label: '⌫', key: '\x7f' },
    { label: 'Enter', key: '\r' },
    { label: 'Ctrl+C', key: '\x03' },
    { label: 'Ctrl+D', key: '\x04' },
    { label: 'Clear', key: 'clear', withEnter: true },
  ] : [
    { label: 'ESC', key: '\x1b' },
    { label: 'Tab', key: '\t' },
    { label: '↑', key: '\x1b[A' },
    { label: '↓', key: '\x1b[B' },
    { label: '←', key: '\x1b[D' },
    { label: '→', key: '\x1b[C' },
    { label: 'Enter', key: '\r' },
    { label: '/clear', key: '/clear', withEnter: true },
    { label: 'Ctrl+C', key: '\x03' },
    { label: 'Ctrl+D', key: '\x04' },
  ];

  const renderKey = (k) => (
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
      className="vk-btn px-2 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
      style={{ 
        minWidth: '36px',
        WebkitTapHighlightColor: 'transparent',
        backgroundColor: pressedKey === k.label ? '#4b5563' : '#374151',
        color: '#fff',
      }}
    >
      {k.label}
    </button>
  );

  return (
    <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-2 py-1.5">
      {/* 所有按键自动换行 */}
      <div className="flex flex-wrap gap-1 justify-start items-center">
        {allKeys.map(renderKey)}
        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-600 mx-1" />
        {/* 输入按钮：聚焦/收起键盘 */}
        <button
          type="button"
          onTouchEnd={(e) => {
            e.preventDefault();
            onToggleInput();
          }}
          className="vk-btn px-2 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
          style={{ 
            minWidth: '40px',
            WebkitTapHighlightColor: 'transparent',
            backgroundColor: inputMode ? '#2563eb' : '#374151',
            color: '#fff',
          }}
        >
          {inputMode ? '收起' : '输入'}
        </button>
        {/* 选择模式切换 */}
        <button
          type="button"
          onTouchEnd={(e) => {
            e.preventDefault();
            onToggleSelect();
          }}
          className="vk-btn px-2 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
          style={{ 
            minWidth: '40px',
            WebkitTapHighlightColor: 'transparent',
            backgroundColor: selectMode ? '#7c3aed' : '#374151',
            color: '#fff',
          }}
        >
          选择
        </button>
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
  const serializeAddon = useRef(null);
  const ws = useRef(null);
  const historyBuffer = useRef(''); // Buffer for history data before rendering
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false); // Track history loading state
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userDisconnected, setUserDisconnected] = useState(false);
  
  // ============================================================
  // 移动端状态
  // ============================================================
  const [selectMode, setSelectMode] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [inputMode, setInputMode] = useState(false);
  const htmlContainerRef = useRef(null);
  
  const isQuickTerminal = selectedSession?.provider === 'quick-terminal' || selectedSession?.__provider === 'quick-terminal';

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
      setIsMobile(window.innerWidth < 768);
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
            try {
              fitAddon.current.fit();
            } catch (error) {
              console.error('[Shell] Error resizing terminal:', error);
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
                projectPath: selectedProjectRef.current?.path || null,
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
          } else if (data.type === 'history-batch') {
            // Buffer history data, don't render yet
            historyBuffer.current += data.data;
            setIsLoadingHistory(true);
          } else if (data.type === 'history-complete') {
            // History loading complete, render all at once
            if (terminal.current && historyBuffer.current) {
              terminal.current.write(historyBuffer.current);
            }
            historyBuffer.current = '';
            setIsLoadingHistory(false);
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

  // ============================================================
  // 切换选择模式：序列化终端为 HTML 供移动端选择复制
  // ============================================================
  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => {
      const newMode = !prev;
      if (newMode && terminal.current && serializeAddon.current) {
        try {
          setHtmlContent(serializeAddon.current.serializeAsHTML());
        } catch (err) {
          console.error('[Shell] Serialize failed:', err);
        }
        terminal.current.blur();
        setInputMode(false);
      } else {
        setHtmlContent('');
      }
      return newMode;
    });
  }, []);

  // ============================================================
  // 切换输入模式：聚焦/取消聚焦终端（弹出/收起系统键盘）
  // ============================================================
  const toggleInputMode = useCallback(() => {
    if (!terminal.current) return;
    
    if (inputMode) {
      terminal.current.blur();
      setInputMode(false);
    } else {
      terminal.current.focus();
      setInputMode(true);
    }
  }, [inputMode]);

  // ============================================================
  // 滚动到顶部/底部
  // ============================================================
  const scrollToTop = useCallback(() => {
    if (terminal.current) {
      terminal.current.scrollToTop();
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (terminal.current) {
      terminal.current.scrollToBottom();
    }
  }, []);

  // 监听终端失焦事件，同步 inputMode 状态
  useEffect(() => {
    if (!terminal.current) return;
    
    const handleBlur = () => setInputMode(false);
    const handleFocus = () => setInputMode(true);
    
    // xterm.js 使用 textarea 接收输入
    const textarea = terminalRef.current?.querySelector('textarea');
    if (textarea) {
      textarea.addEventListener('blur', handleBlur);
      textarea.addEventListener('focus', handleFocus);
      return () => {
        textarea.removeEventListener('blur', handleBlur);
        textarea.removeEventListener('focus', handleFocus);
      };
    }
  }, [isInitialized]);

  const sessionDisplayName = useMemo(() => {
    if (!selectedSession) return null;
    return selectedSession.title || '新会话';
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
      serializeAddon.current = null;
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

    const isMobileNow = window.innerWidth < 768;
    // minimal 模式也需要足够的 scrollback 来存储历史内容供 HTML 显示
    const scrollbackSize = isMobileNow ? 1000 : 10000;

    const terminalOptions = {
      cursorBlink: true,
      fontSize: isMobileNow ? 11 : 14,
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
    if (isMobileNow) {
      terminalOptions.smoothScrollDuration = 0;
      terminalOptions.fastScrollSensitivity = 3;
      terminalOptions.scrollSensitivity = 3;
    } else {
      terminalOptions.fastScrollModifier = 'alt';
      terminalOptions.fastScrollSensitivity = 5;
    }
    
    terminal.current = new Terminal(terminalOptions);
    
    fitAddon.current = new FitAddon();
    serializeAddon.current = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(serializeAddon.current);
    terminal.current.loadAddon(webLinksAddon);

    // Only use WebGL on desktop for better performance
    if (!isMobileNow) {
      try {
        const webglAddon = new WebglAddon();
        terminal.current.loadAddon(webglAddon);
      } catch (error) {
        console.warn('[Shell] WebGL unavailable, using Canvas fallback');
      }
    }
    
    try {
      terminal.current.open(terminalRef.current);
      
      // Initial fit
      setTimeout(() => {
        if (fitAddon.current) {
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
      if (fitAddon.current && !isMobileNow) {
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
      const isMobileCheck = window.innerWidth < 768;
      if (fitAddon.current && terminal.current && !isMobileCheck) {
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
  }, [selectedProject?.path || selectedProject?.path, isRestarting]);

  useEffect(() => {
    if (!autoConnect || !isInitialized || isConnecting || isConnected || userDisconnected) return;
    connectToShell();
  }, [autoConnect, isInitialized, isConnecting, isConnected, userDisconnected, connectToShell]);

  if (minimal) {
    // ============================================================
    // 移动端简化架构：单一 xterm 全屏显示
    // - xterm 负责所有渲染和输入
    // - 选择模式：HTML 弹层显示，支持原生文本选择
    // - 虚拟键盘提供快捷操作
    // ============================================================
    
    return (
      <div className="h-full w-full bg-gray-900 flex flex-col relative">
        {/* 加载历史记录提示 */}
        {isLoadingHistory && (
          <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10">
            <div className="flex items-center space-x-2 bg-gray-800 bg-opacity-90 px-3 py-1.5 rounded-full text-xs text-gray-300">
              <div className="w-3 h-3 animate-spin rounded-full border border-gray-400 border-t-transparent"></div>
              <span>加载历史记录...</span>
            </div>
          </div>
        )}
        
        {/* xterm 全屏显示 - 选择模式下隐藏 */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 relative min-h-0 shell-scroll-container overflow-hidden"
          style={{ display: selectMode ? 'none' : 'block' }}
        >
          <div 
            ref={terminalRef} 
            className="focus:outline-none absolute inset-0"
            style={{ 
              outline: 'none',
              touchAction: 'pan-y',
            }} 
          />
          
          {/* 快速滚动按钮 - 右侧悬浮 */}
          {isConnected && !isLoadingHistory && (
            <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex flex-col gap-2 z-10">
              <button
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  scrollToTop();
                }}
                className="vk-btn w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                style={{ 
                  backgroundColor: 'rgba(55, 65, 81, 0.85)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  scrollToBottom();
                }}
                className="vk-btn w-8 h-8 rounded-full flex items-center justify-center shadow-lg"
                style={{ 
                  backgroundColor: 'rgba(55, 65, 81, 0.85)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          )}
        </div>
        
        {/* 选择模式：HTML 弹层显示 */}
        {selectMode && (
          <div 
            ref={htmlContainerRef}
            className="flex-1 overflow-auto bg-[#1e1e1e] p-2"
            style={{
              userSelect: 'text',
              WebkitUserSelect: 'text',
              touchAction: 'auto',
            }}
          >
            <div 
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              style={{
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: '11px',
                lineHeight: '1.2',
                whiteSpace: 'pre',
                color: '#d4d4d4',
              }}
            />
          </div>
        )}
        
        {/* 虚拟键盘 - 非选择模式显示 */}
        {isMobile && !selectMode && (
          <VirtualKeyboard 
            onKeyPress={handleVirtualKeyPress} 
            onKeyPressWithEnter={handleVirtualKeyPressWithEnter} 
            isConnected={isConnected} 
            isQuickTerminal={isQuickTerminal}
            inputMode={inputMode}
            onToggleInput={toggleInputMode}
            selectMode={selectMode}
            onToggleSelect={toggleSelectMode}
          />
        )}
        
        {/* 选择模式工具栏 */}
        {isMobile && selectMode && (
          <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700 px-2 py-2">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (!htmlContainerRef.current) return;
                  const selection = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(htmlContainerRef.current);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }}
                className="vk-btn px-3 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  backgroundColor: '#374151',
                  color: '#fff',
                }}
              >
                全选
              </button>
              <button
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  const text = window.getSelection()?.toString();
                  if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                      setCopySuccess(true);
                      setTimeout(() => setCopySuccess(false), 1500);
                    }).catch(err => console.error('[Shell] Copy failed:', err));
                  }
                }}
                className="vk-btn px-3 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  backgroundColor: copySuccess ? '#16a34a' : '#2563eb',
                  color: '#fff',
                }}
              >
                {copySuccess ? '已复制' : '复制选中'}
              </button>
              <button
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  toggleSelectMode();
                }}
                className="vk-btn px-3 py-1.5 rounded text-xs font-medium select-none whitespace-nowrap focus:outline-none"
                style={{ 
                  WebkitTapHighlightColor: 'transparent',
                  backgroundColor: '#7c3aed',
                  color: '#fff',
                }}
              >
                退出选择
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 非 minimal 模式（桌面端完整界面）
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
        className="flex-1 relative min-h-0 shell-scroll-container overflow-auto"
        style={{ padding: isMobile ? 0 : '0.5rem' }}
      >
        <div 
          ref={terminalRef} 
          className="focus:outline-none absolute inset-0" 
          style={{ 
            outline: 'none',
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

        {isLoadingHistory && (
          <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10">
            <div className="flex items-center space-x-2 bg-gray-800 bg-opacity-90 px-3 py-1.5 rounded-full text-xs text-gray-300">
              <div className="w-3 h-3 animate-spin rounded-full border border-gray-400 border-t-transparent"></div>
              <span>加载历史记录...</span>
            </div>
          </div>
        )}
      </div>

      {isMobile && (
        <VirtualKeyboard 
          onKeyPress={handleVirtualKeyPress} 
          onKeyPressWithEnter={handleVirtualKeyPressWithEnter} 
          isConnected={isConnected} 
          isQuickTerminal={isQuickTerminal}
          inputMode={inputMode}
          onToggleInput={toggleInputMode}
          selectMode={selectMode}
          onToggleSelect={toggleSelectMode}
        />
      )}
    </div>
  );
}

export default forwardRef(Shell);