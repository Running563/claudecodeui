import React, { memo } from 'react';
import MessageComponent from './MessageComponent';
import ProviderSelector from './ProviderSelector';

/**
 * MessageList - Renders the chat message list with loading states
 * 
 * Handles:
 * - Empty state with ProviderSelector
 * - Loading states (initial load, loading more)
 * - Pagination indicators
 * - Message rendering with MessageComponent
 */
const MessageList = memo(function MessageList({
  // Message data
  chatMessages,
  visibleMessages,
  sessionMessages,
  
  // Loading states
  isLoadingSessionMessages,
  isLoadingMoreMessages,
  
  // Pagination
  hasMoreMessages,
  totalMessages,
  visibleMessageCount,
  loadEarlierMessages,
  
  // Session state
  selectedSession,
  currentSessionId,
  selectedProject,
  
  // Provider state
  provider,
  setProvider,
  cursorModel,
  setCursorModel,
  
  // Callbacks
  createDiff,
  onFileOpen,
  onShowSettings,
  handleEditMessage,
  handleDeleteMessage,
  setImagePreview,
  setToolResultModal,
  
  // Settings
  autoExpandTools,
  showRawParameters,
  showThinking,
  
  // Refs
  textareaRef,
  messagesEndRef,
}) {
  // Initial loading state
  if (isLoadingSessionMessages && chatMessages.length === 0) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
        <div className="flex items-center justify-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
          <p>加载会话消息...</p>
        </div>
      </div>
    );
  }

  // Empty state - show provider selector or continue prompt
  if (chatMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        {!selectedSession && !currentSessionId && (
          <ProviderSelector
            provider={provider}
            setProvider={setProvider}
            cursorModel={cursorModel}
            setCursorModel={setCursorModel}
            textareaRef={textareaRef}
            selectedProject={selectedProject}
          />
        )}
        {selectedSession && (
          <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
            <p className="font-bold text-lg sm:text-xl mb-3">继续您的对话</p>
            <p className="text-sm sm:text-base leading-relaxed">
              询问有关代码的问题、请求更改或获取开发任务的帮助
            </p>
          </div>
        )}
      </div>
    );
  }

  // Get current provider for logo display - use prop first, fallback to localStorage
  const currentProvider = provider || localStorage.getItem('selected-provider') || 'claude';

  return (
    <>
      {/* Loading indicator for older messages */}
      {isLoadingMoreMessages && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-3">
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
            <p className="text-sm">Loading older messages...</p>
          </div>
        </div>
      )}
      
      {/* Indicator showing there are more messages to load */}
      {hasMoreMessages && !isLoadingMoreMessages && (
        <div 
          className="flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm py-3 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          onClick={loadEarlierMessages}
        >
          {totalMessages > 0 && (
            <span>
              {sessionMessages.length} / {totalMessages}  
              <span className="text-xs ml-1">滚动或点击加载更多</span>
            </span>
          )}
        </div>
      )}
      
      {/* Legacy message count indicator (for non-paginated view) */}
      {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
        <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
          Showing last {visibleMessageCount} messages ({chatMessages.length} total) • 
          <button 
            className="ml-1 text-blue-600 hover:text-blue-700 underline"
            onClick={loadEarlierMessages}
          >
            Load earlier messages
          </button>
        </div>
      )}
      
      {/* Message list */}
      {visibleMessages.map((message, index) => {
        const prevMessage = index > 0 ? visibleMessages[index - 1] : null;
        
        return (
          <MessageComponent
            key={index}
            message={message}
            index={index}
            prevMessage={prevMessage}
            createDiff={createDiff}
            onFileOpen={onFileOpen}
            onShowSettings={onShowSettings}
            autoExpandTools={autoExpandTools}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            selectedProject={selectedProject}
            setImagePreview={setImagePreview}
            setToolResultModal={setToolResultModal}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
          />
        );
      })}
      
      {/* Scroll anchor */}
      <div ref={messagesEndRef} />
    </>
  );
});

export default MessageList;
