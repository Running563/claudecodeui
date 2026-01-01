import React, { useState, useEffect } from 'react';
import { X, FolderPlus, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle, Folder } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../utils/api';

const ProjectCreationWizard = ({ onClose, onProjectCreated }) => {
  // 表单状态
  const [selectedPath, setSelectedPath] = useState('');
  const [currentBrowsePath, setCurrentBrowsePath] = useState('~');
  const [actualPath, setActualPath] = useState(''); // API 返回的实际路径
  const [directories, setDirectories] = useState([]);
  const [loadingDirs, setLoadingDirs] = useState(false);

  // UI 状态
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  // 加载目录列表
  useEffect(() => {
    loadDirectories(currentBrowsePath);
  }, [currentBrowsePath]);

  const loadDirectories = async (dirPath) => {
    try {
      setLoadingDirs(true);
      setError(null);
      const response = await api.browseFilesystem(dirPath);
      const data = await response.json();

      if (data.path) {
        setActualPath(data.path); // 保存实际路径
      }
      if (data.suggestions) {
        setDirectories(data.suggestions);
      }
    } catch (error) {
      console.error('加载目录失败:', error);
      setError('加载目录失败');
    } finally {
      setLoadingDirs(false);
    }
  };

  const handleDirectoryClick = (dir) => {
    // 进入子目录
    setCurrentBrowsePath(dir.path);
  };

  const handleSelectDirectory = (dir) => {
    setSelectedPath(dir.path);
  };

  const handleGoUp = () => {
    // 返回上级目录（使用实际路径计算）
    const parentPath = actualPath.replace(/\/[^/]+$/, '') || '/';
    setCurrentBrowsePath(parentPath);
  };

  const handleCreate = async () => {
    if (!selectedPath) {
      setError('请选择一个项目目录');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await api.addProject(selectedPath);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '添加项目失败');
      }

      // 成功
      if (onProjectCreated) {
        onProjectCreated(data.project);
      }

      onClose();
    } catch (error) {
      console.error('添加项目失败:', error);
      setError(error.message || '添加项目失败');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-lg shadow-xl w-full h-full sm:h-auto sm:max-w-2xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              添加项目
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-4 flex-1 overflow-hidden flex flex-col min-h-0">
          {/* 错误提示 */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* 已选择的路径 */}
          {selectedPath && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm text-green-800 dark:text-green-200">已选择：</span>
                <span className="text-sm font-mono text-green-900 dark:text-green-100 break-all">
                  {selectedPath}
                </span>
              </div>
            </div>
          )}

          {/* 当前路径 */}
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>当前目录：</span>
            <span className="font-mono text-gray-900 dark:text-white break-all">
              {actualPath || currentBrowsePath}
            </span>
          </div>

          {/* 目录列表 */}
          <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col min-h-0">
            {/* 返回上级按钮 - 只要不是根目录就显示 */}
            {actualPath && actualPath !== '/' && (
              <button
                onClick={handleGoUp}
                className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 border-b border-gray-200 dark:border-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="text-sm text-gray-600 dark:text-gray-400">返回上级目录</span>
              </button>
            )}

            {/* 目录列表内容 */}
            <div className="flex-1 overflow-y-auto">
              {loadingDirs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  <span className="ml-2 text-sm text-gray-500">加载中...</span>
                </div>
              ) : directories.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                  此目录下没有子目录
                </div>
              ) : (
                directories.map((dir, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 ${
                      selectedPath === dir.path ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <button
                      onClick={() => handleDirectoryClick(dir)}
                      className="flex items-center gap-2 flex-1 text-left"
                    >
                      <Folder className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm text-gray-900 dark:text-white">{dir.name}</span>
                    </button>
                    <Button
                      variant={selectedPath === dir.path ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSelectDirectory(dir)}
                    >
                      {selectedPath === dir.path ? '已选择' : '选择'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 提示信息 */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              选择一个已存在的项目目录，将其添加到项目列表中。
            </p>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isCreating}
          >
            取消
          </Button>

          <Button
            onClick={handleCreate}
            disabled={isCreating || !selectedPath}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                添加中...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-1" />
                添加项目
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectCreationWizard;
