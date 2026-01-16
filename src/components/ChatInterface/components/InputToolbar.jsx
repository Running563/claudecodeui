/**
 * InputToolbar - Toolbar component above the chat input
 * 
 * Contains:
 * - Image upload button
 * - Permission mode selector (弱化样式)
 * - Token usage pie chart
 * - Slash commands button
 * - Clear input button
 * - Refresh button (直接显示)
 * - Scroll to bottom button
 */

import React, { memo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import TokenUsagePie from '../../TokenUsagePie';
import { toast } from '../../GlobalToast';

// 模式配置
const MODE_CONFIG = {
  default: { 
    text: 'Default Mode', 
    dot: 'bg-gray-400 dark:bg-gray-500',
    style: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
  },
  acceptEdits: { 
    text: 'Accept Edits', 
    dot: 'bg-green-400 dark:bg-green-500',
    style: 'bg-green-50/50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/20'
  },
  bypassPermissions: { 
    text: 'Bypass Permissions', 
    dot: 'bg-orange-400 dark:bg-orange-500',
    style: 'bg-orange-50/50 dark:bg-orange-900/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/20'
  },
  plan: { 
    text: 'Plan Mode', 
    dot: 'bg-blue-400 dark:bg-blue-500',
    style: 'bg-blue-50/50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20'
  }
};

const MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];

function InputToolbar({
  inputContainerRef,
  permissionMode,
  cyclePermissionMode,
  tokenBudget,
  slashCommands,
  toggleCommandMenu,
  textareaRef,
  input,
  handleClearInput,
  isUserScrolledUp,
  chatMessages,
  scrollToBottom,
  onRefreshSession,
  // Provider and model selection
  provider,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codebuddyModel,
  setCodebuddyModel,
  // Image upload props
  openFilePicker,
  attachedImages
}) {
  // Claude 可用模型列表
  const claudeModels = [
    { value: 'sonnet', label: 'Sonnet4.5' },
    { value: 'opus', label: 'Opus4.5' },
    { value: 'haiku', label: 'Haiku4.5' }
  ];

  // CodeBuddy 可用模型列表（与 CLI 一致）
  const codebuddyModels = [
    { value: 'default', label: 'Sonnet4.5' },
    { value: 'claude-opus-4.5', label: 'Opus4.5' },
    { value: 'claude-haiku-4.5', label: 'Haiku4.5' },
    { value: 'gemini-3.0-pro', label: 'Gemini3.0Pro' },
    { value: 'deepseek-v3-2-volc-ioa', label: 'DeepSeek V3' }
  ];

  // Cursor 可用模型列表
  const cursorModels = [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'o1-preview', label: 'o1-preview' },
    { value: 'o1-mini', label: 'o1-mini' },
    { value: 'claude-3-opus', label: 'Claude 3 Opus' }
  ];

  // 上传按钮按下状态（移动端视觉反馈）
  const [isUploadPressed, setIsUploadPressed] = useState(false);

  // 处理 mode 切换
  const handlePermissionModeChange = () => {
    const nextMode = MODES[(MODES.indexOf(permissionMode) + 1) % MODES.length];
    toast.show(MODE_CONFIG[nextMode]?.text || 'Default Mode');
    cyclePermissionMode();
  };

  const modeConfig = MODE_CONFIG[permissionMode] || MODE_CONFIG.default;

  return (
    <>
      <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3 relative">
      <div className="flex items-center justify-center gap-2">
        {/* Image upload button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Image upload button clicked');
            openFilePicker();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setIsUploadPressed(true);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsUploadPressed(false);
            console.log('Image upload button touched');
            openFilePicker();
          }}
          onTouchCancel={() => {
            setIsUploadPressed(false);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            setIsUploadPressed(true);
          }}
          onMouseUp={() => {
            setIsUploadPressed(false);
          }}
          onMouseLeave={() => {
            setIsUploadPressed(false);
          }}
          className={`vk-btn w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-all hover:bg-gray-100 dark:hover:bg-gray-700 relative ${
            isUploadPressed ? 'scale-90 bg-gray-200 dark:bg-gray-600' : ''
          }`}
          title="上传图片"
          style={{ 
            touchAction: 'manipulation', 
            WebkitTapHighlightColor: 'transparent', 
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none'
          }}
        >
          <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {attachedImages && attachedImages.length > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center pointer-events-none"
              style={{ fontSize: '10px' }}
            >
              {attachedImages.length}
            </span>
          )}
        </button>

        {/* Permission Mode Selector */}
        <button
          type="button"
          onClick={handlePermissionModeChange}
          className={`w-5 h-5 rounded-full flex items-center justify-center transition-all duration-200 border ${modeConfig.style}`}
          title={modeConfig.text}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${modeConfig.dot}`} />
        </button>

        {/* Model Selector - Claude (无框样式) */}
        {provider === 'claude' && setClaudeModel && (
          <select
            value={claudeModel || 'sonnet'}
            onChange={(e) => {
              setClaudeModel(e.target.value);
              localStorage.setItem('claude-model', e.target.value);
            }}
            className="h-8 px-2 text-xs font-normal bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 focus:outline-none cursor-pointer appearance-none"
            title="选择模型"
          >
            {claudeModels.map(model => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
        )}

        {/* Model Selector - CodeBuddy (无框样式) */}
        {provider === 'codebuddy' && setCodebuddyModel && (
          <select
            value={codebuddyModel || 'default'}
            onChange={(e) => {
              setCodebuddyModel(e.target.value);
              localStorage.setItem('codebuddy-model', e.target.value);
            }}
            className="h-8 px-2 text-xs font-normal bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 focus:outline-none cursor-pointer appearance-none"
            title="选择模型"
          >
            {codebuddyModels.map(model => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
        )}

        {provider === 'cursor' && setCursorModel && (
          <select
            value={cursorModel || 'claude-3-5-sonnet-20241022'}
            onChange={(e) => {
              setCursorModel(e.target.value);
              localStorage.setItem('cursor-model', e.target.value);
            }}
            className="h-8 px-2 text-xs font-normal bg-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 focus:outline-none cursor-pointer appearance-none"
            title="选择模型"
          >
            {cursorModels.map(model => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
        )}

        {/* Token usage pie chart */}
        <TokenUsagePie
          used={tokenBudget?.used || 0}
          total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000}
        />

        {/* Slash commands button */}
        <button
          type="button"
          onClick={toggleCommandMenu}
          className="w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none"
          title="快捷命令"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        {/* Clear input button - 无框样式 */}
        {input.trim() && (
          <button
            type="button"
            onClick={handleClearInput}
            className="w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors"
            title="Clear input"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Refresh button - 直接显示在工具栏 */}
        {onRefreshSession && (
          <button
            type="button"
            onClick={(e) => {
              onRefreshSession();
              // 移除焦点，避免保持激活态
              e.currentTarget.blur();
            }}
            className="w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            title="刷新会话"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {/* Scroll to bottom button */}
        {isUserScrolledUp && chatMessages.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="w-8 h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
            title="Scroll to bottom"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>
    </div>
    </>
  );
}

export default memo(InputToolbar);
