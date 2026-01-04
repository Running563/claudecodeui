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
import InputToolbar from './InputToolbar';
import FileDropdown from './FileDropdown';
import EditingIndicator from './EditingIndicator';
import CommandMenu from '../../CommandMenu';
import ClaudeStatus from '../../ClaudeStatus';
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
  // Edit mode
  editingMessageIndex,
  handleCancelEdit,
  // Claude status
  claudeStatus,
  handleAbortSession,
  provider,
  showThinking,
  // WebSocket message tracking
  wsMessageCount,
  lastMessageTime,
  // Transcript
  handleTranscript,
  // Textarea state & handlers from useInputManagement
  isTextareaExpanded,
  cursorPosition,
  setCursorPosition,
  handleTextareaClick,
  handleTextareaInput,
  handleClearInput,
  placeholderText,
  // Refresh session
  onRefreshSession
}) {
  // Select command handler
  const selectCommand = useCallback((command) => {
    if (!command) return;

    const textBeforeSlash = input.slice(0, slashPosition);
    const textAfterSlash = input.slice(slashPosition);
    const spaceIndex = textAfterSlash.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterSlash.slice(spaceIndex) : '';

    const newInput = textBeforeSlash + command.name + ' ' + textAfterQuery;
    setInput(newInput);
    closeCommandMenu();
    handleCommandSelect(command, -1, false);
  }, [input, slashPosition, setInput, closeCommandMenu, handleCommandSelect]);

  // Input change handler
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    setInput(newValue);
    setCursorPosition(cursorPos);

    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      closeCommandMenu();
      return;
    }

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
          wsMessageCount={wsMessageCount}
          lastMessageTime={lastMessageTime}
        />
      </div>

      {/* Toolbar */}
      <InputToolbar
        inputContainerRef={inputContainerRef}
        permissionMode={permissionMode}
        cyclePermissionMode={cyclePermissionMode}
        tokenBudget={tokenBudget}
        slashCommands={slashCommands}
        toggleCommandMenu={toggleCommandMenu}
        textareaRef={textareaRef}
        input={input}
        handleClearInput={handleClearInput}
        isUserScrolledUp={isUserScrolledUp}
        chatMessages={chatMessages}
        scrollToBottom={scrollToBottom}
        onRefreshSession={onRefreshSession}
      />
      
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
        
        {/* File dropdown */}
        <FileDropdown
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          selectFile={selectFile}
        />

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

        {/* Editing indicator */}
        <EditingIndicator
          editingMessageIndex={editingMessageIndex}
          handleCancelEdit={handleCancelEdit}
        />

        {/* Main input container */}
        <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-600 focus-within:ring-2 focus-within:ring-blue-500 dark:focus-within:ring-blue-500 focus-within:border-blue-500 transition-all duration-200 overflow-hidden ${isTextareaExpanded ? 'chat-input-expanded' : ''}`}>
          <input {...getInputProps()} />
          {/* Dropzone area */}
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
            className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base leading-[21px] sm:leading-6 transition-all duration-200 relative z-10"
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

          {/* Send button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-12 h-12 sm:w-12 sm:h-12 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:ring-offset-gray-800 z-20"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white transform rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>

          {/* Hint text - Desktop only */}
          <div className={`absolute bottom-1 left-12 right-14 sm:right-40 text-xs text-gray-400 dark:text-gray-500 pointer-events-none hidden sm:block transition-opacity duration-200 ${input.trim() ? 'opacity-0' : 'opacity-100'}`}>
            Cmd+Enter 发送 • Enter 换行 • Tab 切换模式 • / 斜杠命令
          </div>
        </div>
      </form>
    </div>
  );
}

export default React.memo(InputArea);
