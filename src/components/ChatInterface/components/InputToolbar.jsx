/**
 * InputToolbar - Toolbar component above the chat input
 * 
 * Contains:
 * - Permission mode selector (弱化样式)
 * - Token usage pie chart
 * - Slash commands button
 * - Clear input button
 * - Refresh button (直接显示)
 * - Scroll to bottom button
 */

import React, { memo } from 'react';
import { RefreshCw } from 'lucide-react';
import TokenUsagePie from '../../TokenUsagePie';

/**
 * Permission mode button styles based on current mode (弱化样式)
 */
const getModeStyles = (mode) => {
  switch (mode) {
    case 'acceptEdits':
      return 'bg-green-50/50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-900/20';
    case 'bypassPermissions':
      return 'bg-orange-50/50 dark:bg-orange-900/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/20';
    case 'plan':
      return 'bg-blue-50/50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20';
    default:
      return 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700';
  }
};

/**
 * Permission mode indicator dot color (弱化颜色)
 */
const getModeDotColor = (mode) => {
  switch (mode) {
    case 'acceptEdits': return 'bg-green-400 dark:bg-green-500';
    case 'bypassPermissions': return 'bg-orange-400 dark:bg-orange-500';
    case 'plan': return 'bg-blue-400 dark:bg-blue-500';
    default: return 'bg-gray-400 dark:bg-gray-500';
  }
};

/**
 * Permission mode display text
 */
const getModeText = (mode) => {
  switch (mode) {
    case 'acceptEdits': return 'Accept Edits';
    case 'bypassPermissions': return 'Bypass Permissions';
    case 'plan': return 'Plan Mode';
    default: return 'Default Mode';
  }
};

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
  onRefreshSession
}) {
  return (
    <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3">
      <div className="flex items-center justify-center gap-2">
        {/* Permission Mode Selector (弱化样式) */}
        <button
          type="button"
          onClick={cyclePermissionMode}
          className={`px-2 py-1 rounded-md text-xs font-normal border transition-all duration-200 ${getModeStyles(permissionMode)}`}
          title="Click to change permission mode (or press Tab in input)"
        >
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${getModeDotColor(permissionMode)}`} />
            <span className="opacity-80">{getModeText(permissionMode)}</span>
          </div>
        </button>

        {/* Token usage pie chart */}
        <TokenUsagePie
          used={tokenBudget?.used || 0}
          total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000}
        />

        {/* Slash commands button */}
        <button
          type="button"
          onClick={() => {
            toggleCommandMenu();
            if (textareaRef.current) {
              textareaRef.current.focus();
            }
          }}
          className="relative w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800"
          title="Show all commands"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          {slashCommands.length > 0 && (
            <span
              className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
              style={{ fontSize: '10px' }}
            >
              {slashCommands.length}
            </span>
          )}
        </button>

        {/* Clear input button */}
        {input.trim() && (
          <button
            type="button"
            onClick={handleClearInput}
            className="w-8 h-8 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group shadow-sm"
            title="Clear input"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  );
}

export default memo(InputToolbar);
