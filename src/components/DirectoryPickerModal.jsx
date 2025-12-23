import React, { useState, useEffect } from 'react';
import { X, Folder, ChevronRight } from 'lucide-react';

function DirectoryPickerModal({ isOpen, onClose, onSelect, currentProject }) {
  const [inputPath, setInputPath] = useState('');
  const [recentDirs, setRecentDirs] = useState([]);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Load recent directories from localStorage
      const stored = localStorage.getItem('recent_terminal_dirs');
      if (stored) {
        try {
          setRecentDirs(JSON.parse(stored));
        } catch (e) {
          setRecentDirs([]);
        }
      }
      
      // Set default to current project if available
      if (currentProject) {
        setInputPath(currentProject.path || currentProject.path || '');
      }
      
      setError('');
    }
  }, [isOpen, currentProject]);

  const validateAndSelect = async (path) => {
    if (!path || !path.trim()) {
      setError('请输入目录路径');
      return;
    }

    setValidating(true);
    setError('');

    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/terminals/validate-dir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ path: path.trim() })
      });

      const data = await response.json();

      if (data.valid) {
        const expandedPath = data.expandedPath || path;
        
        // Save to recent directories
        const updated = [expandedPath, ...recentDirs.filter(d => d !== expandedPath)].slice(0, 5);
        setRecentDirs(updated);
        localStorage.setItem('recent_terminal_dirs', JSON.stringify(updated));
        
        onSelect(expandedPath);
        onClose();
      } else {
        setError(data.error || '目录无效');
      }
    } catch (err) {
      console.error('Validate directory error:', err);
      setError('验证目录失败');
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    validateAndSelect(inputPath);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">选择工作目录</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                目录路径
              </label>
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="/data/codes/claudecodeui"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              {error && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                支持 ~ 表示用户目录，支持相对路径
              </p>
            </div>

            {currentProject && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  快速选择
                </p>
                <button
                  type="button"
                  onClick={() => validateAndSelect(currentProject.path || currentProject.path)}
                  className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 
                           hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <Folder className="w-4 h-4 text-blue-500" />
                    <div className="text-left">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        当前项目
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {currentProject.path || currentProject.path}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            )}

            {recentDirs.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  最近使用
                </p>
                <div className="space-y-1">
                  {recentDirs.map((dir, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => validateAndSelect(dir)}
                      className="w-full flex items-center justify-between p-2 hover:bg-gray-50 
                               dark:hover:bg-gray-700 rounded transition-colors"
                    >
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <Folder className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
                          {dir}
                        </span>
                      </div>
                      <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 
                         hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={validating || !inputPath.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg 
                         hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
              >
                {validating ? '验证中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default DirectoryPickerModal;
