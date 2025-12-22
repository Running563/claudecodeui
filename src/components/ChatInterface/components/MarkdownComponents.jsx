/**
 * Markdown Components
 * 
 * Custom renderers for ReactMarkdown to ensure consistent styling.
 * Includes code blocks with syntax highlighting, tables, images, etc.
 */

import React from 'react';
import { SyntaxHighlighter, vscDarkPlus } from '../config/syntaxHighlighter';
import { authenticatedFetch } from '../../../utils/api';

/**
 * Code block component with syntax highlighting and copy functionality
 */
const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const [copied, setCopied] = React.useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;
  
  // Inline code
  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${
          className || ''
        }`}
        {...props}
      >
        {children}
      </code>
    );
  }
  
  // Extract language from className (format: language-xxx)
  const match = /language-([\w-]+)/.exec(className || '');
  const language = match ? match[1] : '';
  const textToCopy = raw;

  const [isExpanded, setIsExpanded] = React.useState(false);
  const codeContainerRef = React.useRef(null);
  const [needsExpandButton, setNeedsExpandButton] = React.useState(false);

  const handleCopy = () => {
    const doSet = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(doSet).catch(() => {
          // Fallback
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch {}
          document.body.removeChild(ta);
          doSet();
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(ta);
        doSet();
      }
    } catch {}
  };

  // Check if code block needs expand button (only on mobile)
  React.useEffect(() => {
    const checkHeight = () => {
      if (codeContainerRef.current) {
        const isMobile = window.innerWidth < 640; // sm breakpoint
        const scrollHeight = codeContainerRef.current.scrollHeight;
        const maxHeight = 300; // 移动端默认最大高度
        setNeedsExpandButton(isMobile && scrollHeight > maxHeight);
      }
    };
    
    checkHeight();
    window.addEventListener('resize', checkHeight);
    return () => window.removeEventListener('resize', checkHeight);
  }, [raw]);

  return (
    <div className="relative group">
      <div className="absolute top-0.5 right-1 z-10 flex items-center gap-1">
        {/* 展开/收起按钮 (仅移动端且内容超过最大高度时显示) */}
        {needsExpandButton && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setIsExpanded(!isExpanded);
              e.currentTarget.blur();
            }}
            className="code-expand-btn sm:hidden text-xs px-2 py-1 rounded-md bg-gray-700/90 text-white border border-gray-600"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title={isExpanded ? '收起' : '展开'}
            aria-label={isExpanded ? '收起' : '展开'}
          >
            <span className="flex items-center gap-1">
              {isExpanded ? (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15"></polyline>
                  </svg>
                  <span className="text-[10px]">收起</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  <span className="text-[10px]">展开</span>
                </>
              )}
            </span>
          </button>
        )}
        {/* 复制按钮 */}
        <button
          type="button"
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
          title={copied ? 'Copied' : 'Copy code'}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
              </svg>
            </span>
          )}
        </button>
      </div>
      {/* Syntax highlighted code with mobile max-height */}
      <div className="relative">
        <div 
          ref={codeContainerRef}
          className={`overflow-hidden transition-all duration-300 ${
            !isExpanded && needsExpandButton ? 'max-h-[300px] sm:max-h-none' : ''
          }`}
        >
          <SyntaxHighlighter
            language={language}
            style={vscDarkPlus}
            wrapLongLines={false}
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
              overflowX: 'auto',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                whiteSpace: 'pre',
              }
            }}
          >
            {raw}
          </SyntaxHighlighter>
        </div>
        {/* 渐变遮罩 - 仅在移动端未展开时显示 */}
        {!isExpanded && needsExpandButton && (
          <div className="sm:hidden absolute bottom-0 left-0 right-0 h-24 pointer-events-none rounded-b-lg" 
               style={{
                 background: 'linear-gradient(to top, rgba(17, 24, 39, 0.95) 0%, rgba(17, 24, 39, 0.85) 25%, rgba(17, 24, 39, 0.5) 50%, transparent 100%)'
               }}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Image component with authentication support for temp images
 */
const MarkdownImage = ({ src, alt }) => {
  const [blobUrl, setBlobUrl] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!src || !src.includes('.tmp/images/')) {
      setBlobUrl(src);
      setLoading(false);
      return;
    }

    const loadImage = async () => {
      try {
        setLoading(true);
        const response = await authenticatedFetch(`/api/temp-image?path=${encodeURIComponent(src)}`);
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
          setError(false);
        } else {
          console.error('Failed to load image:', src, response.status);
          setError(true);
        }
      } catch (err) {
        console.error('Error loading image:', src, err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    loadImage();

    return () => {
      if (blobUrl && blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [src]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Loading image...
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="inline-block text-sm text-red-600 dark:text-red-400">
        Failed to load image: {alt || src}
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt || 'Image'}
      className="rounded-lg max-w-full h-auto my-2 cursor-pointer hover:opacity-90 transition-opacity"
      onClick={() => window.open(blobUrl, '_blank')}
    />
  );
};

/**
 * Common markdown components configuration for ReactMarkdown
 */
export const markdownComponents = {
  code: CodeBlock,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: MarkdownImage,
  p: ({ children }) => <div className="mb-2 last:mb-0">{children}</div>,
  // GFM tables
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
  )
};

export default markdownComponents;
