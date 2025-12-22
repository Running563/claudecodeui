/**
 * ProviderSelector Component
 * 
 * Displays provider selection UI for choosing between Claude, Cursor, and CodeBuddy.
 * Shows when no session is selected and allows users to pick their AI assistant.
 */

import React, { memo } from 'react';
import ClaudeLogo from '../../ClaudeLogo.jsx';
import CursorLogo from '../../CursorLogo.jsx';
import CodeBuddyLogo from '../../CodeBuddyLogo.jsx';

/**
 * Provider button component
 */
const ProviderButton = memo(({ 
  name, 
  subtitle, 
  Logo, 
  isSelected, 
  colorClass, 
  borderColorClass,
  hoverBorderClass,
  onClick 
}) => (
  <button
    onClick={onClick}
    className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
      isSelected 
        ? `${borderColorClass} shadow-lg ring-2 ring-${colorClass}/20` 
        : `border-gray-200 dark:border-gray-700 ${hoverBorderClass}`
    }`}
  >
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Logo className="w-10 h-10" />
      <div>
        <p className="font-semibold text-gray-900 dark:text-white">{name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
    {isSelected && (
      <div className="absolute top-2 right-2">
        <div className={`w-5 h-5 bg-${colorClass} rounded-full flex items-center justify-center`}>
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
    )}
  </button>
));

ProviderButton.displayName = 'ProviderButton';

/**
 * ProviderSelector component
 * @param {Object} props
 * @param {string} props.provider - Currently selected provider
 * @param {function} props.setProvider - Function to set provider
 * @param {string} props.cursorModel - Currently selected Cursor model
 * @param {function} props.setCursorModel - Function to set Cursor model
 * @param {React.RefObject} props.textareaRef - Reference to textarea for focus
 */
const ProviderSelector = memo(({ 
  provider, 
  setProvider, 
  cursorModel, 
  setCursorModel,
  textareaRef 
}) => {
  const handleProviderSelect = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('selected-provider', newProvider);
    // Focus input after selection
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  return (
    <div className="text-center px-6 sm:px-4 py-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">选择您的 AI 助手</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        选择一个提供商来开始新对话
      </p>
      
      <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
        {/* Claude Button */}
        <button
          onClick={() => handleProviderSelect('claude')}
          className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
            provider === 'claude' 
              ? 'border-blue-500 shadow-lg ring-2 ring-blue-500/20' 
              : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
          }`}
        >
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <ClaudeLogo className="w-10 h-10" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Claude</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">by Anthropic</p>
            </div>
          </div>
          {provider === 'claude' && (
            <div className="absolute top-2 right-2">
              <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
        </button>
        
        {/* Cursor Button */}
        <button
          onClick={() => handleProviderSelect('cursor')}
          className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
            provider === 'cursor' 
              ? 'border-purple-500 shadow-lg ring-2 ring-purple-500/20' 
              : 'border-gray-200 dark:border-gray-700 hover:border-purple-400'
          }`}
        >
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <CursorLogo className="w-10 h-10" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Cursor</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">AI Code Editor</p>
            </div>
          </div>
          {provider === 'cursor' && (
            <div className="absolute top-2 right-2">
              <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
        </button>
        
        {/* CodeBuddy Button */}
        <button
          onClick={() => handleProviderSelect('codebuddy')}
          className={`group relative w-64 h-32 bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 hover:scale-105 hover:shadow-xl ${
            provider === 'codebuddy' 
              ? 'border-green-500 shadow-lg ring-2 ring-green-500/20' 
              : 'border-gray-200 dark:border-gray-700 hover:border-green-400'
          }`}
        >
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <CodeBuddyLogo className="w-10 h-10" />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">CodeBuddy</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Tencent Cloud AI</p>
            </div>
          </div>
          {provider === 'codebuddy' && (
            <div className="absolute top-2 right-2">
              <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          )}
        </button>
      </div>
      
      {/* Model Selection for Cursor - Always reserve space to prevent jumping */}
      <div className={`mb-6 transition-opacity duration-200 ${provider === 'cursor' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {provider === 'cursor' ? '选择模型' : '\u00A0'}
        </label>
        <select
          value={cursorModel}
          onChange={(e) => {
            const newModel = e.target.value;
            setCursorModel(newModel);
            localStorage.setItem('cursor-model', newModel);
          }}
          className="pl-4 pr-10 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-w-[140px]"
          disabled={provider !== 'cursor'}
        >
          <option value="gpt-5">GPT-5</option>
          <option value="sonnet-4">Sonnet-4</option>
          <option value="opus-4.1">Opus 4.1</option>
        </select>
      </div>
      
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {provider === 'claude' 
          ? '准备使用 Claude AI。在下方开始输入您的消息。'
          : provider === 'cursor'
          ? `准备使用 Cursor 和 ${cursorModel}。在下方开始输入您的消息。`
          : provider === 'codebuddy'
          ? '准备使用 CodeBuddy AI。在下方开始输入您的消息。'
          : '在上方选择一个提供商以开始'
        }
      </p>
    </div>
  );
});

ProviderSelector.displayName = 'ProviderSelector';

export default ProviderSelector;
