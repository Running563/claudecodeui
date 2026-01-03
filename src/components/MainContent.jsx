/*
 * MainContent.jsx - Main Content Area with Session Protection Props Passthrough
 * 
 * SESSION PROTECTION PASSTHROUGH:
 * ===============================
 * 
 * This component serves as a passthrough layer for Session Protection functions:
 * - Receives session management functions from App.jsx
 * - Passes them down to ChatInterface.jsx
 * 
 * No session protection logic is implemented here - it's purely a props bridge.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ChatInterface from './ChatInterface';
import FileTree from './FileTree';
import CodeEditor from './CodeEditor';
import StandaloneShell from './StandaloneShell';
import GitPanel from './GitPanel';
import TerminalListView from './TerminalListView';
import ErrorBoundary from './ErrorBoundary';
import { authenticatedFetch, getProjectId, api } from '../utils/api';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import CodeBuddyLogo from './CodeBuddyLogo';
import Tooltip from './Tooltip';
import { MoreVertical, Unplug, RotateCcw, RefreshCw, MessageSquare, Terminal, Trash2, Edit3, Settings } from 'lucide-react';

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  messages,
  isMobile,
  isPWA,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  // Session Protection Props: Functions passed down from App.jsx to manage active session state
  // These functions control when project updates are paused during active conversations
  onSessionActive,        // Mark session as active when user sends message
  onSessionInactive,      // Mark session as inactive when conversation completes/aborts
  onSessionProcessing,    // Mark session as processing (thinking/working)
  onSessionNotProcessing, // Mark session as not processing (finished thinking)
  onSessionCompleted,     // Mark session as recently completed (prevents file watcher race conditions)
  processingSessions,     // Set of session IDs currently processing
  onReplaceTemporarySession, // Replace temporary session ID with real session ID from WebSocket
  onNavigateToSession,    // Navigate to a specific session (for Claude CLI session duplication workaround)
  onShowSettings,         // Show tools settings panel
  autoExpandTools,        // Auto-expand tool accordions
  showRawParameters,      // Show raw parameters in tool accordions
  showThinking,           // Show thinking/reasoning sections
  autoScrollToBottom,     // Auto-scroll to bottom when new messages arrive
  sendByCtrlEnter,        // Send by Ctrl+Enter mode for East Asian language input
  externalMessageUpdate,  // Trigger for external CLI updates to current session
  onToggleQuickSettings,  // Toggle quick settings panel
  onSelectTerminal,       // Select a terminal from the list
  onCreateTerminal,       // Create a new terminal
  // Background task support
  getProjectTasks,        // Get tasks for a specific project
  onSessionTitleUpdate    // Update session title in sidebar
}) {
  const [editingFile, setEditingFile] = useState(null);
  const [editorWidth, setEditorWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const resizeRef = useRef(null);
  
  // Shell state for mobile header controls
  const shellRef = useRef(null);
  const [shellState, setShellState] = useState({
    isConnected: false,
    isConnecting: false,
    isInitialized: false,
    isRestarting: false,
    sessionDisplayNameShort: null
  });
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  // Mobile header more menu state (for chat tab)
  const [mobileMoreMenuOpen, setMobileMoreMenuOpen] = useState(false);
  // Trigger to clear chat messages
  const [clearChatTrigger, setClearChatTrigger] = useState(0);
  // Edit title modal state
  const [showEditTitleModal, setShowEditTitleModal] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const editTitleInputRef = useRef(null);

  // Clear chat handler - calls backend truncate API directly
  const handleClearChat = useCallback(async () => {
    if (!selectedProject || !selectedSession?.id) {
      console.warn('Cannot clear chat: no project or session selected');
      return;
    }

    try {
      // Use epoch time to delete all messages
      const keepUntilTimestamp = new Date(0).toISOString();
      
      const response = await authenticatedFetch(
        `/api/projects/${getProjectId(selectedProject)}/sessions/${selectedSession.id}/truncate`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepUntilTimestamp })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to clear session');
      }

      // Disconnect shell if connected, so next time it will reload fresh session
      if (shellRef.current?.isConnected) {
        shellRef.current.disconnect();
      }

      // Trigger frontend clear after successful backend call
      setClearChatTrigger(prev => prev + 1);
    } catch (error) {
      console.error('Failed to clear chat:', error);
    }
  }, [selectedProject, selectedSession]);

  // Start editing title - open modal
  const handleStartEditTitle = useCallback(() => {
    if (!selectedSession) return;
    setEditTitleValue(selectedSession.title || '');
    setShowEditTitleModal(true);
    setMobileMoreMenuOpen(false);
    // Focus input after modal opens
    setTimeout(() => {
      editTitleInputRef.current?.focus();
      editTitleInputRef.current?.select();
    }, 100);
  }, [selectedSession]);

  // Save edited title
  const handleSaveTitle = useCallback(async () => {
    if (!selectedProject || !selectedSession?.id || !editTitleValue.trim()) {
      setShowEditTitleModal(false);
      return;
    }

    try {
      const response = await authenticatedFetch(
        `/api/db/projects/${getProjectId(selectedProject)}/sessions/${selectedSession.id}/title`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: editTitleValue.trim() })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update title');
      }

      // Notify parent to update sidebar and selectedSession
      onSessionTitleUpdate?.(selectedSession.id, editTitleValue.trim());
      
      setShowEditTitleModal(false);
    } catch (error) {
      console.error('Failed to update title:', error);
      setShowEditTitleModal(false);
    }
  }, [selectedProject, selectedSession, editTitleValue, onSessionTitleUpdate]);

  // Cancel editing title
  const handleCancelEditTitle = useCallback(() => {
    setShowEditTitleModal(false);
    setEditTitleValue('');
  }, []);
  
  const handleFileOpen = (filePath, diffInfo = null) => {
    // Create a file object that CodeEditor expects
    const file = {
      name: filePath.split('/').pop(),
      path: filePath,
      projectId: getProjectId(selectedProject),
      diffInfo: diffInfo // Pass along diff information if available
    };
    setEditingFile(file);
  };

  const handleCloseEditor = () => {
    setEditingFile(null);
    setEditorExpanded(false);
  };

  const handleToggleEditorExpand = () => {
    setEditorExpanded(!editorExpanded);
  };

  // Handle resize functionality
  const handleMouseDown = (e) => {
    if (isMobile) return; // Disable resize on mobile
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;

      const container = resizeRef.current?.parentElement;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;

      // Min width: 300px, Max width: 80% of container
      const minWidth = 300;
      const maxWidth = containerRect.width * 0.8;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setEditorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with menu button for mobile */}
        {isMobile && (
          <div
            className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0"
          >
            <button
              onClick={onMenuClick}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 pwa-menu-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400">
            <div className="w-12 h-12 mx-auto mb-4">
              <div 
                className="w-full h-full rounded-full border-4 border-gray-200 border-t-blue-500" 
                style={{ 
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite'
                }} 
              />
            </div>
            <h2 className="text-xl font-semibold mb-2">加载 Claude Code UI</h2>
            <p>正在设置您的工作区...</p>
          </div>
        </div>
      </div>
    );
  }

  // If no project selected and not on shell/terminals tab, show project selection prompt
  if (!selectedProject && activeTab !== 'shell' && activeTab !== 'terminals') {
    return (
      <div className="h-full flex flex-col">
        {/* Header with menu button for mobile */}
        {isMobile && (
          <div
            className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0"
          >
            <button
              onClick={onMenuClick}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 pwa-menu-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
        {/* PC端只显示快捷终端tab按钮（终端需要选中项目才显示） */}
        {!isMobile && (
          <div className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                选择项目以开始使用
              </div>
              <div className="flex-shrink-0">
                <div className="relative flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  <Tooltip content="快捷终端" position="bottom">
                    <button
                      onClick={() => setActiveTab('terminals')}
                      className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                        activeTab === 'terminals'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="flex items-center gap-1 sm:gap-1.5">
                        <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="hidden md:hidden lg:inline">快捷终端</span>
                      </span>
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500 dark:text-gray-400 max-w-md mx-auto px-6">
            <div className="w-16 h-16 mx-auto mb-6 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-3 text-gray-900 dark:text-white">选择您的项目</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6 leading-relaxed">
              从侧边栏选择项目以开始使用 Claude 编码。每个项目包含您的聊天会话和文件历史。
            </p>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                💡 <strong>提示:</strong> {isMobile ? '点击上方菜单按钮访问项目' : '点击侧边栏的文件夹图标创建新项目，或点击右上角终端按钮打开Shell'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Shell or Terminals tab without project - show standalone shell or terminals list
  if (!selectedProject && (activeTab === 'shell' || activeTab === 'terminals')) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0">
          <div className="flex items-center justify-between relative">
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              {isMobile && (
                <button
                  onClick={onMenuClick}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex items-center gap-2 flex-1">
                {activeTab === 'shell' && (
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${shellState.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                    {activeTab === 'shell' 
                      ? (shellState.sessionDisplayNameShort ? `${shellState.sessionDisplayNameShort}...` : 'Shell')
                      : '快捷终端'
                    }
                  </h2>
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {activeTab === 'shell' ? 'Home' : '管理您的终端'}
                  </div>
                </div>
              </div>
              {/* Mobile Shell Controls - 与快捷终端保持一致 */}
              {isMobile && activeTab === 'shell' && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 更多菜单 */}
                  <div className="relative">
                    <button
                      onClick={() => setShellMenuOpen(!shellMenuOpen)}
                      className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-manipulation"
                      aria-label="菜单"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    {shellMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShellMenuOpen(false)}
                        />
                        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-700 
                                      rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 
                                      py-1 z-50 min-w-[140px]">
                          {shellState.isConnected ? (
                            <>
                              <button
                                onClick={() => {
                                  shellRef.current?.disconnect();
                                  setShellMenuOpen(false);
                                }}
                                className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                         text-red-500 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                              >
                                <Unplug className="w-4 h-4" />
                                <span>断开连接</span>
                              </button>
                              <button
                                onClick={() => {
                                  shellRef.current?.reconnect();
                                  setShellMenuOpen(false);
                                }}
                                className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                         text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                              >
                                <RefreshCw className="w-4 h-4" />
                                <span>断开重连</span>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                shellRef.current?.restart();
                                setShellMenuOpen(false);
                              }}
                              disabled={shellState.isRestarting}
                              className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                       text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 
                                       disabled:opacity-50 touch-manipulation"
                            >
                              <RotateCcw className="w-4 h-4" />
                              <span>重启终端</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* PC Tab Navigation */}
            {!isMobile && (
              <div className="flex-shrink-0">
                <div className="relative flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                  <Tooltip content="终端" position="bottom">
                    <button
                      onClick={() => setActiveTab('shell')}
                      className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                        activeTab === 'shell'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="flex items-center gap-1 sm:gap-1.5">
                        <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span className="hidden md:hidden lg:inline">终端</span>
                      </span>
                    </button>
                  </Tooltip>
                  <Tooltip content="快捷终端" position="bottom">
                    <button
                      onClick={() => setActiveTab('terminals')}
                      className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                        activeTab === 'terminals'
                          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="flex items-center gap-1 sm:gap-1.5">
                        <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span className="hidden md:hidden lg:inline">快捷终端</span>
                      </span>
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Content - Shell or Terminals */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* Keep Shell mounted but hidden to preserve terminal state */}
          <div style={{ display: activeTab === 'shell' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
            <StandaloneShell
              ref={shellRef}
              project={null}
              session={null}
              showHeader={false}
              minimal={true}
              isActive={activeTab === 'shell'}
              onShellStateChange={setShellState}
            />
          </div>
          {activeTab === 'terminals' && (
            <TerminalListView
              onSelectTerminal={onSelectTerminal}
              onCreateNew={onCreateTerminal}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div
        className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0"
      >
        <div className="flex items-center justify-between relative">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            {isMobile && (
              <button
                onClick={onMenuClick}
                className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 touch-manipulation active:scale-95 pwa-menu-button flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <div className="min-w-0 flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
              {/* Provider icon removed from here for mobile - moved to subtitle */}
              {!isMobile && activeTab === 'chat' && selectedSession && (
                <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                  {selectedSession.provider === 'codebuddy' ? (
                    <CodeBuddyLogo className="w-4 h-4" />
                  ) : selectedSession.provider === 'cursor' ? (
                    <CursorLogo className="w-4 h-4" />
                  ) : (
                    <ClaudeLogo className="w-4 h-4" />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {(activeTab === 'chat' || activeTab === 'shell') && isMobile ? (
                  // Mobile: Combined chat/shell header with provider icon in subtitle
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                      {activeTab === 'chat' 
                        ? (selectedSession?.title || '新会话')
                        : (shellState.sessionDisplayNameShort ? `${shellState.sessionDisplayNameShort}...` : 'Shell')
                      }
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                      {activeTab === 'chat' && selectedSession && (
                        <>
                          {selectedSession.provider === 'codebuddy' ? (
                            <CodeBuddyLogo className="w-3 h-3" />
                          ) : selectedSession.provider === 'cursor' ? (
                            <CursorLogo className="w-3 h-3" />
                          ) : (
                            <ClaudeLogo className="w-3 h-3" />
                          )}
                        </>
                      )}
                      {activeTab === 'shell' && (
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${shellState.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                      )}
                      <span>{selectedProject?.displayName || 'Home'}</span>
                    </div>
                  </div>
                ) : activeTab === 'chat' && selectedSession ? (
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                      {selectedSession.title || '新会话'}
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName}
                    </div>
                  </div>
                ) : activeTab === 'chat' && !selectedSession ? (
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                      新会话
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName}
                    </div>
                  </div>
                ) : activeTab === 'shell' ? (
                  <div className="min-w-0 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${shellState.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate">
                        {shellState.sessionDisplayNameShort ? `${shellState.sessionDisplayNameShort}...` : 'Shell'}
                      </h2>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {selectedProject?.displayName || 'Home'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                      {activeTab === 'files' ? '项目文件' :
                       activeTab === 'git' ? '源代码' :
                       activeTab === 'terminals' ? '终端列表' :
                       '项目'}
                    </h2>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {selectedProject.displayName}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Mobile Chat/Shell Controls */}
            {isMobile && (activeTab === 'chat' || activeTab === 'shell') && (
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Chat/Shell Toggle Button */}
                <button
                  onClick={() => setActiveTab(activeTab === 'chat' ? 'shell' : 'chat')}
                  className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-manipulation"
                  aria-label={activeTab === 'chat' ? '切换到终端' : '切换到聊天'}
                >
                  {activeTab === 'chat' ? (
                    <Terminal className="w-5 h-5" />
                  ) : (
                    <MessageSquare className="w-5 h-5" />
                  )}
                </button>
                {/* More Menu */}
                <div className="relative">
                  <button
                    onClick={() => {
                      if (activeTab === 'shell') {
                        setShellMenuOpen(!shellMenuOpen);
                        setMobileMoreMenuOpen(false);
                      } else {
                        setMobileMoreMenuOpen(!mobileMoreMenuOpen);
                        setShellMenuOpen(false);
                      }
                    }}
                    className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded touch-manipulation"
                    aria-label="菜单"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>
                  {/* Shell Menu */}
                  {shellMenuOpen && activeTab === 'shell' && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShellMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-700 
                                    rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 
                                    py-1 z-50 min-w-[140px]">
                        {shellState.isConnected ? (
                          <>
                            <button
                              onClick={() => {
                                shellRef.current?.disconnect();
                                setShellMenuOpen(false);
                              }}
                              className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                       text-red-500 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                            >
                              <Unplug className="w-4 h-4" />
                              <span>断开连接</span>
                            </button>
                            <button
                              onClick={() => {
                                shellRef.current?.reconnect();
                                setShellMenuOpen(false);
                              }}
                              className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                       text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                            >
                              <RefreshCw className="w-4 h-4" />
                              <span>断开重连</span>
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              shellRef.current?.restart();
                              setShellMenuOpen(false);
                            }}
                            disabled={shellState.isRestarting}
                            className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                     text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 
                                     disabled:opacity-50 touch-manipulation"
                          >
                            <RotateCcw className="w-4 h-4" />
                            <span>重启终端</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {/* Chat Menu */}
                  {mobileMoreMenuOpen && activeTab === 'chat' && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMobileMoreMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-700 
                                    rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 
                                    py-1 z-50 min-w-[140px]">
                        <button
                          onClick={() => {
                            onToggleQuickSettings?.();
                            setMobileMoreMenuOpen(false);
                          }}
                          className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                   text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                        >
                          <Settings className="w-4 h-4" />
                          <span>快速设置</span>
                        </button>
                        {selectedSession && (
                          <button
                            onClick={handleStartEditTitle}
                            className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                     text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                          >
                            <Edit3 className="w-4 h-4" />
                            <span>修改标题</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            handleClearChat();
                            setMobileMoreMenuOpen(false);
                          }}
                          className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                   text-red-500 hover:bg-gray-100 dark:hover:bg-gray-600 touch-manipulation"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>清空会话</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Modern Tab Navigation - Right Side */}
          <div className="flex-shrink-0 hidden sm:block">
            <div className="relative flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <Tooltip content="聊天" position="bottom">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md ${
                    activeTab === 'chat'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">聊天</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="终端" position="bottom">
                <button
                  onClick={() => setActiveTab('shell')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'shell'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">终端</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="文件" position="bottom">
                <button
                  onClick={() => setActiveTab('files')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'files'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">文件</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="源代码" position="bottom">
                <button
                  onClick={() => setActiveTab('git')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'git'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">源代码</span>
                  </span>
                </button>
              </Tooltip>
              <Tooltip content="快捷终端" position="bottom">
                <button
                  onClick={() => setActiveTab('terminals')}
                  className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                    activeTab === 'terminals'
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="hidden md:hidden lg:inline">快捷终端</span>
                  </span>
                </button>
              </Tooltip>
               {/* <button
                onClick={() => setActiveTab('preview')}
                className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all duration-200 ${
                  activeTab === 'preview'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              > 
                <span className="flex items-center gap-1 sm:gap-1.5">
                  <svg className="w-3 sm:w-3.5 h-3 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  <span className="hidden sm:inline">Preview</span>
                </span>
              </button> */}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area with Right Sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Main Content */}
        <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${editingFile ? 'mr-0' : ''} ${editorExpanded ? 'hidden' : ''}`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails={true}>
              <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              messages={messages}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onSessionProcessing={onSessionProcessing}
              onSessionNotProcessing={onSessionNotProcessing}
              onSessionCompleted={onSessionCompleted}
              processingSessions={processingSessions}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              autoScrollToBottom={autoScrollToBottom}
              sendByCtrlEnter={sendByCtrlEnter}
              externalMessageUpdate={externalMessageUpdate}
              onToggleQuickSettings={onToggleQuickSettings}
              getProjectTasks={getProjectTasks}
              clearChatTrigger={clearChatTrigger}
            />
          </ErrorBoundary>
        </div>
        {activeTab === 'files' && (
          <div className="h-full overflow-hidden">
            <FileTree selectedProject={selectedProject} />
          </div>
        )}
        {/* Keep Shell mounted but hidden to preserve terminal state */}
        <div style={{ display: activeTab === 'shell' ? 'flex' : 'none', height: '100%', width: '100%', overflow: 'hidden' }}>
          <StandaloneShell
            ref={shellRef}
            project={selectedProject}
            session={selectedSession}
            showHeader={false}
            minimal={true}
            isActive={activeTab === 'shell'}
            onShellStateChange={setShellState}
          />
        </div>
        {activeTab === 'git' && (
          <div className="h-full overflow-hidden">
            <GitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
          </div>
        )}
        {activeTab === 'terminals' && (
          <div className="h-full overflow-hidden">
            <TerminalListView
              onSelectTerminal={onSelectTerminal}
              onCreateNew={onCreateTerminal}
            />
          </div>
        )}
        <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`}>
          {/* <LivePreviewPanel
            selectedProject={selectedProject}
            serverStatus={serverStatus}
            serverUrl={serverUrl}
            availableScripts={availableScripts}
            onStartServer={(script) => {
              sendMessage({
                type: 'server:start',
                projectPath: selectedProject?.path,
                script: script
              });
            }}
            onStopServer={() => {
              sendMessage({
                type: 'server:stop',
                projectPath: selectedProject?.path
              });
            }}
            onScriptSelect={setCurrentScript}
            currentScript={currentScript}
            isMobile={isMobile}
            serverLogs={serverLogs}
            onClearLogs={() => setServerLogs([])}
          /> */}
        </div>
        </div>

        {/* Code Editor Right Sidebar - Desktop only, Mobile uses modal */}
        {editingFile && !isMobile && (
          <>
            {/* Resize Handle - Hidden when expanded */}
            {!editorExpanded && (
              <div
                ref={resizeRef}
                onMouseDown={handleMouseDown}
                className="flex-shrink-0 w-1 bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 dark:hover:bg-blue-600 cursor-col-resize transition-colors relative group"
                title="Drag to resize"
              >
                {/* Visual indicator on hover */}
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-blue-500 dark:bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {/* Editor Sidebar */}
            <div
              className={`flex-shrink-0 border-l border-gray-200 dark:border-gray-700 h-full overflow-hidden ${editorExpanded ? 'flex-1' : ''}`}
              style={editorExpanded ? {} : { width: `${editorWidth}px` }}
            >
              <CodeEditor
                file={editingFile}
                onClose={handleCloseEditor}
                projectPath={selectedProject?.path}
                isSidebar={true}
                isExpanded={editorExpanded}
                onToggleExpand={handleToggleEditorExpand}
              />
            </div>
          </>
        )}
      </div>

      {/* Code Editor Modal for Mobile */}
      {editingFile && isMobile && (
        <CodeEditor
          file={editingFile}
          onClose={handleCloseEditor}
          projectPath={selectedProject?.path}
          isSidebar={false}
        />
      )}

      {/* Edit Title Modal */}
      {showEditTitleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleCancelEditTitle}>
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-4 w-[90%] max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">修改会话标题</h3>
            <input
              ref={editTitleInputRef}
              type="text"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') handleCancelEditTitle();
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                       bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="输入新标题"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={handleCancelEditTitle}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 
                         bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 
                         rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveTitle}
                className="px-4 py-2 text-sm font-medium text-white 
                         bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(MainContent);