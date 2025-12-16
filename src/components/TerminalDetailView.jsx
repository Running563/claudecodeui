import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, MoreVertical, Trash2, Copy, Eraser } from 'lucide-react';
import Shell from './Shell';

function TerminalDetailView({ 
  terminal, 
  onBack, 
  onDelete,
  onClone 
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const shellRef = useRef(null);
  const terminalIdRef = useRef(terminal?.id);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    terminalIdRef.current = terminal?.id;
  }, [terminal?.id]);

  const handleClear = () => {
    // Clear terminal display - Shell component handles this via ref
    if (shellRef.current && shellRef.current.terminal) {
      shellRef.current.terminal.clear();
      shellRef.current.terminal.write('\x1b[2J\x1b[H'); // Clear screen and move cursor to home
    }
    setMenuOpen(false);
  };

  const handleDelete = async () => {
    if (!confirm('确认删除此终端？如果有进程正在运行，将被终止。')) {
      return;
    }

    // Disconnect shell first
    if (shellRef.current && shellRef.current.disconnect) {
      shellRef.current.disconnect();
    }

    setMenuOpen(false);
    await onDelete(terminal.id);
  };

  const handleClone = async () => {
    // Don't disconnect - just let the component unmount naturally
    // This preserves the PTY session for when we switch back
    setMenuOpen(false);
    await onClone(terminal.id);
  };

  if (!terminal) {
    return null;
  }

  // Create a project-like object for Shell component
  const terminalProject = {
    path: terminal.workingDir,
    fullPath: terminal.workingDir,
    displayName: terminal.workingDir.split('/').pop() || 'Terminal'
  };

  return (
    <div className="fixed inset-0 bg-white dark:bg-gray-900 z-[100] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <button
              onClick={onBack}
              className="p-1 hover:bg-gray-700 rounded touch-manipulation"
              aria-label="返回"
            >
              <ChevronLeft className="w-5 h-5 text-gray-300" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-100">
                终端 {terminal.id.replace('terminal_', '#')}
              </div>
              <div className="text-xs text-gray-400 truncate">
                📁 {terminal.workingDir}
              </div>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 hover:bg-gray-700 rounded touch-manipulation"
              aria-label="菜单"
            >
              <MoreVertical className="w-5 h-5 text-gray-300" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 bg-gray-700 
                              rounded-lg shadow-lg border border-gray-600 
                              py-1 z-50 min-w-[140px]">
                  <button
                    onClick={handleClear}
                    className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                             text-gray-300 hover:bg-gray-600 touch-manipulation"
                  >
                    <Eraser className="w-4 h-4" />
                    <span>清空输出</span>
                  </button>
                  <button
                    onClick={handleClone}
                    className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                             text-gray-300 hover:bg-gray-600 touch-manipulation"
                  >
                    <Copy className="w-4 h-4" />
                    <span>复制终端</span>
                  </button>
                  <div className="border-t border-gray-600 my-1" />
                  <button
                    onClick={handleDelete}
                    className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                             text-red-400 hover:bg-gray-600 touch-manipulation"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>删除终端</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Terminal Content - 使用 flex-1 确保占据剩余空间 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Shell
          key={terminal.id}
          ref={shellRef}
          selectedProject={terminalProject}
          selectedSession={{ id: terminal.id, __provider: 'quick-terminal' }}
          isPlainShell={false}
          minimal={true}
          autoConnect={true}
        />
      </div>
    </div>
  );
}

export default TerminalDetailView;
