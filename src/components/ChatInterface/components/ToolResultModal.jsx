import React from 'react';
import { SyntaxHighlighter, vscDarkPlus } from '../config/syntaxHighlighter';
import { stripAnsi } from '../utils';

/**
 * ToolResultModal - Modal for displaying tool execution results
 * 
 * @param {Object} toolResultModal - Modal data with message and toolName
 * @param {Function} onClose - Callback to close the modal
 * @param {Function} onFileOpen - Callback to open a file
 */
const ToolResultModal = ({ toolResultModal, onClose, onFileOpen }) => {
  if (!toolResultModal) return null;

  const { message, toolName } = toolResultModal;
  // Support both data structures: legacy (toolResult.content) and new (toolResult.toolUseResult.content)
  const rawContent = message.toolResult?.toolUseResult?.content || message.toolResult?.content;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  const toolData = message.toolResult?.toolUseResult;

  const renderContent = () => {
    // Read tool with syntax highlighting
    if (toolName === 'Read') {
      // Try to get content from structured result first, then fall back to rawContent
      const readContent = toolData?.content || rawContent;
      const language = toolData?.renderer?.context?.language || 'text';
      const title = stripAnsi(toolData?.title || 'File content');
      
      if (readContent && (toolData?.renderer?.type === 'code' || typeof readContent === 'string')) {
        return (
          <div>
            <div className="flex items-center gap-2 mb-3 md:mb-4">
              <span className="text-sm md:text-base font-medium text-gray-900 dark:text-gray-100">{title}</span>
            </div>
            <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
              <SyntaxHighlighter
                language={language}
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: '0.75rem',
                  fontSize: '0.75rem',
                  lineHeight: '1.5',
                  maxHeight: '70vh',
                  overflowY: 'auto'
                }}
                showLineNumbers={true}
              >
                {stripAnsi(String(readContent))}
              </SyntaxHighlighter>
            </div>
          </div>
        );
      }
    }

    // Grep/Glob content mode - display full search results
    if ((toolName === 'Grep' || toolName === 'Glob') && rawContent && Array.isArray(rawContent) && rawContent.length > 0) {
      // 如果 rawContent 是字符串数组（搜索结果行）
      const lines = rawContent.map(line => stripAnsi(line));
      const title = stripAnsi(`Found ${lines.length} ${lines.length === 1 ? 'match' : 'matches'}`);
      return (
        <div>
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <span className="text-sm md:text-base font-medium text-gray-900 dark:text-gray-100">{title}</span>
          </div>
          <div className="bg-gray-800 dark:bg-gray-950 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
            <pre className="p-3 md:p-4 text-xs font-mono overflow-x-auto">
              <code className="text-gray-100 dark:text-gray-200 whitespace-pre">
                {lines.join('\n')}
              </code>
            </pre>
          </div>
        </div>
      );
    }

    // Grep/Glob with toolUseResult.content
    if ((toolName === 'Grep' || toolName === 'Glob') && toolData?.content && Array.isArray(toolData.content) && toolData.content.length > 0) {
      const lines = toolData.content.map(line => stripAnsi(line));
      const title = stripAnsi(toolData.title || `Found ${toolData.content.length} lines`);
      return (
        <div>
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <span className="text-sm md:text-base font-medium text-gray-900 dark:text-gray-100">{title}</span>
          </div>
          <div className="bg-gray-800 dark:bg-gray-950 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
            <pre className="p-3 md:p-4 text-xs font-mono overflow-x-auto">
              <code className="text-gray-100 dark:text-gray-200 whitespace-pre">
                {lines.join('\n')}
              </code>
            </pre>
          </div>
        </div>
      );
    }

    // Grep/Glob files mode - display file list
    if ((toolName === 'Grep' || toolName === 'Glob') && toolData?.filenames && Array.isArray(toolData.filenames) && toolData.filenames.length > 0) {
      return (
        <div>
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <span className="text-sm md:text-base font-medium text-gray-900 dark:text-gray-100">
              Found {toolData.numFiles || toolData.filenames.length} {(toolData.numFiles === 1 || toolData.filenames.length === 1) ? 'file' : 'files'}
            </span>
          </div>
          <div className="space-y-1">
            {toolData.filenames.map((filePath, index) => {
              const cleanPath = stripAnsi(filePath);
              const fileName = cleanPath.split('/').pop();
              const dirPath = cleanPath.substring(0, cleanPath.lastIndexOf('/'));

              return (
                <div
                  key={index}
                  onClick={() => {
                    if (onFileOpen) {
                      onFileOpen(cleanPath);
                      onClose();
                    }
                  }}
                  className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                >
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-blue-900 dark:group-hover:text-blue-100">
                      {fileName}
                    </div>
                    <div className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                      {dirPath}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // Default: display raw content
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 md:p-4">
        <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words overflow-x-auto">
          {stripAnsi(content)}
        </pre>
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <div 
        className="relative w-full h-full md:h-auto md:max-w-4xl md:max-h-[85vh] bg-white dark:bg-gray-900 md:rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 md:px-4 md:py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 rounded-lg flex items-center justify-center shadow-lg">
              <svg className="w-3 h-3 md:w-4 md:h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white">{toolName} Result</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 md:p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4 md:w-5 md:h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ToolResultModal);
