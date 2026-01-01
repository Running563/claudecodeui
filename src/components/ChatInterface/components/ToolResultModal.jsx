import React from 'react';
import { SyntaxHighlighter, vscDarkPlus } from '../config/syntaxHighlighter';
import { stripAnsi, calculateDiff } from '../utils';

/**
 * Render a unified diff view
 */
const DiffView = ({ oldString, newString }) => {
  if (!oldString && !newString) {
    return <div className="text-gray-400 dark:text-gray-500 text-xs p-4">(no changes)</div>;
  }
  
  // For new file (no old content), show all as additions
  if (!oldString && newString) {
    const lines = newString.split('\n');
    return (
      <div className="font-mono text-xs py-2">
        {lines.map((line, index) => (
          <div
            key={index}
            className="flex bg-green-50 dark:bg-green-950/50 border-l-2 border-green-500"
          >
            <span className="w-8 md:w-12 flex-shrink-0 text-right pr-2 py-0.5 text-green-600 dark:text-green-400 select-none border-r border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-900/30">
              +{index + 1}
            </span>
            <span className="pl-2 pr-3 py-0.5 text-green-700 dark:text-green-300 whitespace-pre-wrap break-all">{line || ' '}</span>
          </div>
        ))}
      </div>
    );
  }
  
  // For deletion (no new content), show all as removals
  if (oldString && !newString) {
    const lines = oldString.split('\n');
    return (
      <div className="font-mono text-xs py-2">
        {lines.map((line, index) => (
          <div
            key={index}
            className="flex bg-red-50 dark:bg-red-950/50 border-l-2 border-red-500"
          >
            <span className="w-8 md:w-12 flex-shrink-0 text-right pr-2 py-0.5 text-red-600 dark:text-red-400 select-none border-r border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-900/30">
              -{index + 1}
            </span>
            <span className="pl-2 pr-3 py-0.5 text-red-700 dark:text-red-300 whitespace-pre-wrap break-all line-through">{line || ' '}</span>
          </div>
        ))}
      </div>
    );
  }
  
  // Calculate diff
  const diffLines = calculateDiff(oldString, newString);
  
  if (diffLines.length === 0) {
    return <div className="text-gray-400 dark:text-gray-500 text-xs p-4">(no changes detected)</div>;
  }
  
  return (
    <div className="font-mono text-xs py-2">
      {diffLines.map((line, index) => {
        const isAddition = line.type === 'added';
        const isDeletion = line.type === 'removed';
        
        return (
          <div
            key={index}
            className={`flex ${
              isAddition 
                ? 'bg-green-50 dark:bg-green-950/50 border-l-2 border-green-500' 
                : isDeletion 
                  ? 'bg-red-50 dark:bg-red-950/50 border-l-2 border-red-500'
                  : ''
            }`}
          >
            <span className={`w-8 md:w-12 flex-shrink-0 text-right pr-2 py-0.5 select-none border-r ${
              isAddition 
                ? 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 bg-green-100/50 dark:bg-green-900/30' 
                : isDeletion
                  ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-100/50 dark:bg-red-900/30'
                  : 'text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700'
            }`}>
              {isAddition ? '+' : '-'}{line.lineNum}
            </span>
            <span className={`pl-2 pr-3 py-0.5 whitespace-pre-wrap break-all ${
              isAddition 
                ? 'text-green-700 dark:text-green-300' 
                : isDeletion
                  ? 'text-red-700 dark:text-red-300 line-through'
                  : 'text-gray-600 dark:text-gray-400'
            }`}>
              {line.content || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
};

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

  // Parse tool input for Bash command
  let bashInput = null;
  if (toolName === 'Bash' && message.toolInput) {
    try {
      bashInput = JSON.parse(message.toolInput);
    } catch (e) {
      // ignore
    }
  }

  // Parse tool input for Edit/Write
  let editInput = null;
  if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') && message.toolInput) {
    try {
      editInput = JSON.parse(message.toolInput);
    } catch (e) {
      // ignore
    }
  }

  const renderContent = () => {
    // Edit/Write tool with diff view
    if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
      const filePath = editInput?.file_path || '';
      const isWrite = toolName === 'Write';
      const isMultiEdit = toolName === 'MultiEdit';
      
      // For Write tool: content is the new file content
      // For Edit tool: old_string and new_string
      // For MultiEdit tool: edits array
      const oldString = editInput?.old_string || '';
      const newString = editInput?.new_string || editInput?.content || '';
      const edits = editInput?.edits || [];
      
      return (
        <div className="space-y-3">
          {/* File Path Header */}
          <div className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="font-mono text-sm text-gray-700 dark:text-gray-300 truncate">{filePath}</span>
            </div>
            <button
              onClick={() => {
                if (onFileOpen && filePath) {
                  if (isWrite) {
                    onFileOpen(filePath, { old_string: '', new_string: newString });
                  } else if (isMultiEdit && edits.length > 0) {
                    const combinedOld = edits.map(e => e.old_string || '').join('\n...\n');
                    const combinedNew = edits.map(e => e.new_string || '').join('\n...\n');
                    onFileOpen(filePath, { old_string: combinedOld, new_string: combinedNew });
                  } else {
                    onFileOpen(filePath, { old_string: oldString, new_string: newString });
                  }
                  onClose();
                }
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex-shrink-0"
            >
              Open in Editor
            </button>
          </div>
          
          {/* Diff View */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {isMultiEdit && edits.length > 0 ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {edits.map((edit, index) => (
                  <div key={index}>
                    <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      Edit {index + 1} of {edits.length}
                    </div>
                    <DiffView oldString={edit.old_string || ''} newString={edit.new_string || ''} />
                  </div>
                ))}
              </div>
            ) : (
              <DiffView oldString={oldString} newString={newString} />
            )}
          </div>
          
          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            {isMultiEdit ? (
              <span>{edits.length} edit{edits.length !== 1 ? 's' : ''}</span>
            ) : (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  {oldString ? oldString.split('\n').length : 0} lines removed
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  {newString ? newString.split('\n').length : 0} lines added
                </span>
              </>
            )}
          </div>
        </div>
      );
    }
    
    // Bash tool with structured output
    if (toolName === 'Bash') {
      // Parse structured bash result
      let stdout = '';
      let stderr = '';
      let exitCode = null;
      let signal = null;
      
      // Try to parse structured result from toolData
      if (toolData) {
        stdout = toolData.stdout || toolData.content || '';
        stderr = toolData.stderr || '';
        exitCode = toolData.exitCode ?? toolData.exit_code ?? null;
        signal = toolData.signal || null;
      } else if (content) {
        // Fallback: content is the stdout
        stdout = content;
      }
      
      // Clean ANSI codes
      stdout = stripAnsi(String(stdout));
      stderr = stripAnsi(String(stderr));
      
      return (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="p-3 md:p-4 font-mono text-xs space-y-2">
            {/* Command */}
            {bashInput?.command && (
              <div>
                <span className="text-gray-500 dark:text-gray-400">Command: </span>
                <span className="text-gray-800 dark:text-gray-200">{bashInput.command}</span>
              </div>
            )}
            
            {/* Stdout */}
            <div>
              <span className="text-gray-500 dark:text-gray-400">Stdout: </span>
              {stdout ? (
                <pre className="mt-1 whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">{stdout}</pre>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">(empty)</span>
              )}
            </div>
            
            {/* Stderr */}
            <div>
              <span className="text-gray-500 dark:text-gray-400">Stderr: </span>
              {stderr ? (
                <pre className="mt-1 whitespace-pre-wrap break-words text-red-600 dark:text-red-400">{stderr}</pre>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">(empty)</span>
              )}
            </div>
            
            {/* Exit Code */}
            <div>
              <span className="text-gray-500 dark:text-gray-400">Exit Code: </span>
              <span className={exitCode === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                {exitCode ?? 'N/A'}
              </span>
            </div>
            
            {/* Signal */}
            <div>
              <span className="text-gray-500 dark:text-gray-400">Signal: </span>
              <span className="text-gray-800 dark:text-gray-200">{signal || '(none)'}</span>
            </div>
          </div>
        </div>
      );
    }
    
    // Read tool with syntax highlighting
    if (toolName === 'Read') {
      // Try to get content from structured result first, then fall back to rawContent
      const readContent = toolData?.content || rawContent;
      const language = toolData?.renderer?.context?.language || 'text';
      const title = stripAnsi(toolData?.title || 'File content');
      
      if (readContent && (toolData?.renderer?.type === 'code' || typeof readContent === 'string')) {
        const contentStr = stripAnsi(String(readContent));
        // Check if content has inline line numbers (format: "  1→" or "123→")
        const hasInlineLineNumbers = /^\s*\d+→/.test(contentStr);
        
        // If has inline line numbers, parse and render with custom line numbers
        if (hasInlineLineNumbers) {
          const lines = contentStr.split('\n');
          const processedLines = [];
          const lineNumbers = [];
          
          lines.forEach(line => {
            const match = line.match(/^\s*(\d+)→(.*)$/);
            if (match) {
              lineNumbers.push(match[1]);
              processedLines.push(match[2]);
            } else {
              lineNumbers.push('');
              processedLines.push(line);
            }
          });
          
          const codeContent = processedLines.join('\n');
          
          return (
            <div>
              <div className="flex items-center gap-2 mb-3 md:mb-4">
                <span className="text-sm md:text-base font-medium text-gray-900 dark:text-gray-100">{title}</span>
              </div>
              <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden max-h-[70vh] overflow-y-auto">
                <SyntaxHighlighter
                  language={language}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: 0,
                    fontSize: '0.75rem',
                    lineHeight: '1.5',
                    background: 'transparent'
                  }}
                  showLineNumbers={true}
                  lineNumberStyle={{ minWidth: '3em', paddingRight: '1em', textAlign: 'right', userSelect: 'none', color: '#6b7280' }}
                  startingLineNumber={parseInt(lineNumbers[0]) || 1}
                  lineNumberContainerStyle={{ float: 'left', paddingRight: '1em' }}
                  wrapLines={true}
                  wrapLongLines={true}
                  lineProps={() => ({ style: { display: 'block', paddingLeft: '0.5rem', paddingRight: '0.5rem' } })}
                >
                  {codeContent}
                </SyntaxHighlighter>
              </div>
            </div>
          );
        }
        
        // No inline line numbers, use SyntaxHighlighter
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
                {contentStr}
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
