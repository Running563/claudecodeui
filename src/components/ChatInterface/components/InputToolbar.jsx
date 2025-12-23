/**
 * InputToolbar - Toolbar component above the chat input
 * 
 * Contains:
 * - Permission mode selector
 * - Token usage pie chart
 * - Slash commands button
 * - Clear input button
 * - Quick settings button
 * - Scroll to bottom button
 */

import React, { memo } from 'react';
import TokenUsagePie from '../../TokenUsagePie';

/**
 * Permission mode button styles based on current mode
 */
const getModeStyles = (mode) => {
  switch (mode) {
    case 'acceptEdits':
      return 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30';
    case 'bypassPermissions':
      return 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30';
    case 'plan':
      return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30';
    default:
      return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600';
  }
};

/**
 * Permission mode indicator dot color
 */
const getModeDotColor = (mode) => {
  switch (mode) {
    case 'acceptEdits': return 'bg-green-500';
    case 'bypassPermissions': return 'bg-orange-500';
    case 'plan': return 'bg-blue-500';
    default: return 'bg-gray-500';
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
  onToggleQuickSettings,
  isUserScrolledUp,
  chatMessages,
  scrollToBottom
}) {
  return (
    <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3">
      <div className="flex items-center justify-center gap-3">
        {/* Permission Mode Selector */}
        <button
          type="button"
          onClick={cyclePermissionMode}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${getModeStyles(permissionMode)}`}
          title="Click to change permission mode (or press Tab in input)"
        >
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getModeDotColor(permissionMode)}`} />
            <span>{getModeText(permissionMode)}</span>
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

        {/* Quick Settings button */}
        {onToggleQuickSettings && (
          <button
            type="button"
            onClick={onToggleQuickSettings}
            className="w-8 h-8 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Quick Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
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
