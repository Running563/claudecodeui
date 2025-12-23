/**
 * InputArea - Chat input area component
 * 
 * Handles:
 * - Text input with auto-resize
 * - File dropdown (@mentions)
 * - Command menu (slash commands)
 * - Image attachments
 * - Permission mode selector
 * - Claude status display
 */

import React, { useCallback } from 'react';
import ImageAttachment from './ImageAttachment';
import CommandMenu from '../../CommandMenu';
import TokenUsagePie from '../../TokenUsagePie';
import ClaudeStatus from '../../ClaudeStatus';
import { MicButton } from '../../MicButton.jsx';
import { useInputKeyboard } from '../hooks';

/**
 * InputArea component for chat input
 */
function InputArea({
  // Input state
  input,
  setInput,
  isLoading,
  isInputFocused,
  setIsInputFocused,
  handleSubmit,
  sendByCtrlEnter,
  // Permission mode
  permissionMode,
  cyclePermissionMode,
  // Image upload props
  attachedImages,
  removeImage,
  uploadingImages,
  imageErrors,
  getRootProps,
  getInputProps,
  isDragActive,
  openFilePicker,
  handleImagePaste,
  // File dropdown props
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  setSelectedFileIndex,
  selectFile,
  closeFileDropdown,
  // Command menu props
  showCommandMenu,
  setShowCommandMenu,
  filteredCommands,
  selectedCommandIndex,
  setSelectedCommandIndex,
  handleCommandSelect,
  slashCommands,
  frequentCommands,
  commandQuery,
  setCommandQuery,
  slashPosition,
  setSlashPosition,
  toggleCommandMenu,
  closeCommandMenu,
  detectSlashCommand,
  // Token budget
  tokenBudget,
  // Refs
  textareaRef,
  inputContainerRef,
  // Scroll
  scrollToBottom,
  isUserScrolledUp,
  chatMessages,
  // Quick settings
  onToggleQuickSettings,
  // Edit mode
  editingMessageIndex,
  handleCancelEdit,
  // Claude status
  claudeStatus,
  handleAbortSession,
  provider,
  showThinking,
  // Transcript
  handleTranscript,
  // Textarea state & handlers from useInputManagement
  isTextareaExpanded,
  cursorPosition,
  setCursorPosition,
  handleTextareaClick,
  handleTextareaInput,
  handleClearInput,
  placeholderText
}) {
  // Select command handler
  const selectCommand = useCallback((command) => {
    if (!command) return;

    // Prepare the input with command name and any arguments that were already typed
    const textBeforeSlash = input.slice(0, slashPosition);
    const textAfterSlash = input.slice(slashPosition);
    const spaceIndex = textAfterSlash.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterSlash.slice(spaceIndex) : '';

    const newInput = textBeforeSlash + command.name + ' ' + textAfterQuery;

    // Update input temporarily so executeCommand can parse arguments
    setInput(newInput);

    // Hide command menu and clear debounce timer
    closeCommandMenu();

    // Execute the command via handleCommandSelect
    handleCommandSelect(command, -1, false);
  }, [input, slashPosition, setInput, closeCommandMenu, handleCommandSelect]);

  // Input change handler
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setInput(newValue);
    setCursorPosition(cursorPos);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      closeCommandMenu();
      return;
    }

    // Detect slash command at cursor position
    detectSlashCommand(newValue, cursorPos);
  }, [setInput, setCursorPosition, closeCommandMenu, detectSlashCommand]);

  // Keyboard handler via hook
  const { handleKeyDown } = useInputKeyboard({
    showCommandMenu,
    filteredCommands,
    selectedCommandIndex,
    setSelectedCommandIndex,
    closeCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    setSelectedFileIndex,
    selectFile,
    closeFileDropdown,
    selectCommand,
    cyclePermissionMode,
    handleSubmit,
    sendByCtrlEnter
  });

  return (
    <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 ${
      isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-2 sm:pb-4 md:pb-6'
    }`}>
      {/* Claude Status */}
      <div className="flex-1">
        <ClaudeStatus
          status={claudeStatus}
          isLoading={isLoading}
          onAbort={handleAbortSession}
          provider={provider}
          showThinking={showThinking}
        />
      </div>

      {/* Permission Mode Selector with scroll to bottom button - Above input, clickable for mobile */}
      <div ref={inputContainerRef} className="max-w-4xl mx-auto mb-3">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={cyclePermissionMode}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 ${
              permissionMode === 'default' 
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                : permissionMode === 'acceptEdits'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-300 dark:border-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                : permissionMode === 'bypassPermissions'
                ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-600 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30'
            }`}
            title="Click to change permission mode (or press Tab in input)"
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                permissionMode === 'default' 
                  ? 'bg-gray-500'
                  : permissionMode === 'acceptEdits'
                  ? 'bg-green-500'
                  : permissionMode === 'bypassPermissions'
                  ? 'bg-orange-500'
                  : 'bg-blue-500'
              }`} />
              <span>
                {permissionMode === 'default' && 'Default Mode'}
                {permissionMode === 'acceptEdits' && 'Accept Edits'}
                {permissionMode === 'bypassPermissions' && 'Bypass Permissions'}
                {permissionMode === 'plan' && 'Plan Mode'}
              </span>
            </div>
          </button>

          {/* Token usage pie chart - positioned next to mode indicator */}
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
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
              />
            </svg>
            {/* Command count badge */}
            {slashCommands.length > 0 && (
              <span
                className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
                style={{ fontSize: '10px' }}
              >
                {slashCommands.length}
              </span>
            )}
          </button>

          {/* Clear input button - positioned to the right of token pie, only shows when there's input */}
          {input.trim() && (
            <button
              type="button"
              onClick={handleClearInput}
              className="w-8 h-8 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-full flex items-center justify-center transition-all duration-200 group shadow-sm"
              title="Clear input"
            >
              <svg
                className="w-4 h-4 text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
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

          {/* Scroll to bottom button - positioned last */}
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
      
      <form onSubmit={handleSubmit} className="relative max-w-4xl mx-auto">
        {/* Drag overlay */}
        {isDragActive && (
          <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-lg">
              <svg className="w-8 h-8 text-blue-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium">Drop images here</p>
            </div>
          </div>
        )}
        
        {/* Image attachments preview */}
        {attachedImages.length > 0 && (
          <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex flex-wrap gap-2">
              {attachedImages.map((file, index) => (
                <ImageAttachment
                  key={index}
                  file={file}
                  onRemove={() => removeImage(index)}
                  uploadProgress={uploadingImages.get(file.name)}
                  error={imageErrors.get(file.name)}
                />
              ))}
            </div>
          </div>
        )}
        
        {/* File dropdown - positioned outside dropzone to avoid conflicts */}
        {showFileDropdown && filteredFiles.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 backdrop-blur-sm">
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-4 py-3 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0 touch-manipulation ${
                  index === selectedFileIndex
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
                onMouseDown={(e) => {
                  // Prevent textarea from losing focus on mobile
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  selectFile(file);
                }}
              >
                <div className="font-medium text-sm">{file.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {file.path}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Command Menu */}
        <CommandMenu
          commands={filteredCommands}
          selectedIndex={selectedCommandIndex}
          onSelect={handleCommandSelect}
          onClose={() => {
            setShowCommandMenu(false);
            setSlashPosition(-1);
            setCommandQuery('');
            setSelectedCommandIndex(-1);
          }}
          position={{
            top: textareaRef.current
              ? Math.max(16, textareaRef.current.getBoundingClientRect().top - 316)
              : 0,
            left: textareaRef.current
              ? textareaRef.current.getBoundingClientRect().left
              : 16,
            bottom: textareaRef.current
              ? window.innerHeight - textareaRef.current.getBoundingClientRect().top + 8
              : 90
          }}
          isOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
        />

        {/* Editing message indicator */}
        {editingMessageIndex !== null && (
          <div className="mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>正在编辑消息 - 发送后将删除此消息之后的所有内容</span>
            </div>
            <button
              onClick={handleCancelEdit}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium text-sm transition-colors"
            >
              取消
            </button>
          </div>
        )}

        <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 overflow-hidden ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
          <input {...getInputProps()} />
          {/* Dropzone area - wrapped in a separate div to avoid interfering with buttons */}
          <div {...getRootProps()} className="absolute inset-0 pointer-events-none">
            <div className="pointer-events-auto absolute inset-0" style={{ left: '48px', right: '64px' }}></div>
          </div>
          
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onClick={handleTextareaClick}
            onKeyDown={handleKeyDown}
            onPaste={handleImagePaste}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onInput={handleTextareaInput}
            placeholder={placeholderText}
            disabled={isLoading}
            className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base leading-[21px] sm:leading-6 transition-all duration-200 relative z-10"
            style={{ height: '50px' }}
          />
          {/* Image upload button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
            className="absolute left-2 top-1/2 transform -translate-y-1/2 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors z-20"
            title="Attach images"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          
          {/* Mic button - HIDDEN */}
          <div className="absolute right-16 sm:right-16 top-1/2 transform -translate-y-1/2 z-20" style={{ display: 'none' }}>
            <MicButton
              onTranscript={handleTranscript}
              className="w-10 h-10 sm:w-10 sm:h-10"
            />
          </div>

          {/* Send button with explicit click handler to prevent dropzone interference */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            onMouseDown={(e) => {
              // Prevent textarea from losing focus before submit
              e.preventDefault();
            }}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 z-20"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          >
            <svg 
              className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" 
              />
            </svg>
          </button>

          {/* Hint text inside input box at bottom - Desktop only */}
          <div className={`absolute bottom-1 left-12 right-14 sm:right-40 text-xs text-gray-400 dark:text-gray-500 pointer-events-none hidden sm:block transition-opacity duration-200 ${
            input.trim() ? 'opacity-0' : 'opacity-100'
          }`}>
            {sendByCtrlEnter
              ? "Ctrl+Enter 发送 • Shift+Enter 换行 • Tab 切换模式 • / 斜杠命令"
              : "Enter 发送 • Shift+Enter 换行 • Tab 切换模式 • / 斜杠命令"}
          </div>
        </div>
      </form>
    </div>
  );
}

export default React.memo(InputArea);
