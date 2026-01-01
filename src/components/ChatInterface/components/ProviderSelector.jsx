/**
 * ProviderSelector Component
 * 
 * Displays provider selection UI for choosing between Claude and CodeBuddy.
 * Shows when no session is selected and allows users to pick their AI assistant.
 */

import React, { memo } from 'react';
import ClaudeLogo from '../../ClaudeLogo.jsx';
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
 * @param {React.RefObject} props.textareaRef - Reference to textarea for focus
 */
const ProviderSelector = memo(({ 
  provider, 
  setProvider, 
  textareaRef,
  selectedProject
}) => {
  const handleProviderSelect = (newProvider) => {
    setProvider(newProvider);
    localStorage.setItem('selected-provider', newProvider);
    // Focus input after selection
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  return (
    <div className="text-center px-6 sm:px-4 py-8">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-10">{selectedProject?.displayName || '选择您的 AI 助手'}</h2>
      
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
      
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {provider === 'claude' 
          ? '准备使用 Claude AI。在下方开始输入您的消息。'
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
