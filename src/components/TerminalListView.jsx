import React, { useState, useEffect } from 'react';
import { Plus, ChevronRight, MoreVertical, Trash2, Copy, Infinity, Clock } from 'lucide-react';
import { ConfirmDialog } from './ui/confirm-dialog';

function TerminalListView({ onSelectTerminal, onCreateNew }) {
  const [terminals, setTerminals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  useEffect(() => {
    loadTerminals();
  }, []);

  const loadTerminals = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/terminals', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setTerminals(data);
      }
    } catch (error) {
      console.error('Load terminals error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (terminalId, e) => {
    e.stopPropagation();
    
    setConfirmDialog({
      isOpen: true,
      title: '删除终端',
      message: '确认删除此终端？如果有进程正在运行，将被终止。',
      onConfirm: async () => {
        try {
          const token = localStorage.getItem('auth-token');
          await fetch(`/api/terminals/${terminalId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          setTerminals(terminals.filter(t => t.id !== terminalId));
          setMenuOpenId(null);
        } catch (error) {
          console.error('Delete terminal error:', error);
        }
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleClone = async (terminalId, e) => {
    e.stopPropagation();
    
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/terminals/${terminalId}/clone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        await loadTerminals();
        setMenuOpenId(null);
        // Auto open the cloned terminal
        onSelectTerminal(data.terminal);
      }
    } catch (error) {
      console.error('Clone terminal error:', error);
      alert('复制失败');
    }
  };

  const handleToggleKeepAlive = async (terminal, e) => {
    e.stopPropagation();
    
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch(`/api/terminals/${terminal.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keepAlive: !terminal.keepAlive })
      });
      
      if (response.ok) {
        setTerminals(terminals.map(t => 
          t.id === terminal.id ? { ...t, keepAlive: !t.keepAlive } : t
        ));
        setMenuOpenId(null);
      }
    } catch (error) {
      console.error('Toggle keep alive error:', error);
      alert('操作失败');
    }
  };

  const formatTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}天前`;
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    return '刚刚';
  };

  const toggleMenu = (terminalId, e) => {
    e.stopPropagation();
    setMenuOpenId(menuOpenId === terminalId ? null : terminalId);
  };

  return (
    <>
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText="删除"
        cancelText="取消"
        variant="destructive"
      />
      <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-card">
        <div className="p-4">
          <h1 className="text-xl font-semibold text-foreground">终端列表</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的终端会话</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* New Terminal Button */}
        <button
          onClick={onCreateNew}
          className="w-full flex items-center justify-center space-x-2 p-4 mb-4
                   bg-blue-50 dark:bg-blue-900 dark:bg-opacity-20 
                   hover:bg-blue-100 dark:hover:bg-blue-900 dark:hover:bg-opacity-30
                   border-2 border-dashed border-blue-300 dark:border-blue-700
                   rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-blue-600 dark:text-blue-400">新建终端</span>
        </button>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-muted-foreground">
            加载中...
          </div>
        )}

        {/* Empty State */}
        {!loading && terminals.length === 0 && (
          <div className="text-center py-12">
            <div className="text-muted-foreground mb-2">暂无终端</div>
            <div className="text-sm text-muted-foreground">
              点击上方按钮创建新终端
            </div>
          </div>
        )}

        {/* Terminals List */}
        {!loading && terminals.length > 0 && (
          <div className="space-y-2">
            {terminals.map((terminal, index) => (
              <div
                key={terminal.id}
                className="relative"
              >
                <div
                  onClick={() => onSelectTerminal(terminal)}
                  className="w-full flex items-center justify-between p-3 
                           bg-card hover:bg-accent
                           border border-border rounded-lg transition-colors text-left cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="text-sm font-medium text-foreground">
                        终端 #{index + 1}
                      </span>
                      {terminal.keepAlive && (
                        <span className="flex items-center text-xs text-green-500" title="永不清理">
                          <Infinity className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-1 text-xs text-muted-foreground mb-1">
                      <span>📁</span>
                      <span className="truncate">{terminal.workingDir}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTime(terminal.lastActivity)}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-2">
                    <button
                      onClick={(e) => toggleMenu(terminal.id, e)}
                      className="p-1 hover:bg-accent rounded"
                    >
                      <MoreVertical className="w-4 h-4 text-muted-foreground" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </div>

                {/* Context Menu */}
                {menuOpenId === terminal.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpenId(null)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-card 
                                  rounded-lg shadow-lg border border-border 
                                  py-1 z-50 min-w-[120px]">
                      <button
                        onClick={(e) => handleToggleKeepAlive(terminal, e)}
                        className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                 text-foreground hover:bg-accent"
                      >
                        {terminal.keepAlive ? (
                          <>
                            <Clock className="w-4 h-4" />
                            <span>允许清理</span>
                          </>
                        ) : (
                          <>
                            <Infinity className="w-4 h-4" />
                            <span>永不清理</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={(e) => handleClone(terminal.id, e)}
                        className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                 text-foreground hover:bg-accent"
                      >
                        <Copy className="w-4 h-4" />
                        <span>复制终端</span>
                      </button>
                      <button
                        onClick={(e) => handleDelete(terminal.id, e)}
                        className="w-full flex items-center space-x-2 px-4 py-2 text-sm
                                 text-red-600 dark:text-red-400 hover:bg-accent"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>删除终端</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

export default TerminalListView;
