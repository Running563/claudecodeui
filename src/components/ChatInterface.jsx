/*
 * ChatInterface.jsx - Chat Component with Session Protection Integration
 * 
 * SESSION PROTECTION INTEGRATION:
 * ===============================
 * 
 * This component integrates with the Session Protection System to prevent project updates
 * from interrupting active conversations:
 * 
 * Key Integration Points:
 * 1. handleSubmit() - Marks session as active when user sends message (including temp ID for new sessions)
 * 2. session-created handler - Replaces temporary session ID with real WebSocket session ID  
 * 3. claude-complete handler - Marks session as inactive when conversation finishes
 * 4. session-aborted handler - Marks session as inactive when conversation is aborted
 * 
 * This ensures uninterrupted chat experience by coordinating with App.jsx to pause sidebar updates.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useDropzone } from 'react-dropzone';

// ============================================================================
// Utility Functions for Image Handling and Text Processing
// ============================================================================

/**
 * Strips ANSI escape sequences (terminal color codes) from a string
 * @param {string} str - String that may contain ANSI codes
 * @returns {string} - Clean string without ANSI codes
 */
const stripAnsi = (str) => {
  if (typeof str !== 'string') return str;
  // Remove ANSI escape sequences using regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
};

/**
 * Extracts base64 image data from tool result content
 * Handles both array format and string format
 * @param {any} content - Tool result content (can be array, string, or object)
 * @returns {string|null} - Base64 data URL or null if no image found
 */
const extractBase64FromContent = (content) => {
  // Parse JSON string if needed
  if (typeof content === 'string') {
    try {
      if (content.startsWith('[') || content.startsWith('{')) {
        content = JSON.parse(content);
      }
    } catch (e) {
      // Not valid JSON, check if it's already a data URL
      const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
      return match ? match[0] : null;
    }
  }
  
  // Check if content is array with image object
  if (Array.isArray(content)) {
    const imageItem = content.find(item => item?.type === 'image');
    if (imageItem?.source?.type === 'base64') {
      const mediaType = imageItem.source.media_type || 'image/png';
      return `data:${mediaType};base64,${imageItem.source.data}`;
    }
  }
  
  return null;
};

/**
 * Checks if tool result content contains image data
 * @param {any} content - Tool result content
 * @returns {boolean}
 */
const hasImageContent = (content) => {
  return Array.isArray(content) && content.some(item => item?.type === 'image');
};
// 直接从 dist 路径导入 PrismLight，避免引入主包导致加载所有语言
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
// 只导入常用语言
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';

SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('diff', diff);
import TodoList from './TodoList';
import ClaudeLogo from './ClaudeLogo.jsx';
import CursorLogo from './CursorLogo.jsx';
import CodeBuddyLogo from './CodeBuddyLogo.jsx';

import ClaudeStatus from './ClaudeStatus';
import TokenUsagePie from './TokenUsagePie';
import { MicButton } from './MicButton.jsx';
import { api, authenticatedFetch } from '../utils/api';
import Fuse from 'fuse.js';
import CommandMenu from './CommandMenu';


// Helper function to decode HTML entities in text
function decodeHtmlEntities(text) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Normalize markdown text where providers mistakenly wrap short inline code with single-line triple fences.
// Only convert fences that do NOT contain any newline to avoid touching real code blocks.
function normalizeInlineCodeFences(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    // ```code```  -> `code`
    return text.replace(/```\s*([^\n\r]+?)\s*```/g, '`$1`');
  } catch {
    return text;
  }
}

// Unescape \n, \t, \r while protecting LaTeX formulas ($...$ and $$...$$) from being corrupted
function unescapeWithMathProtection(text) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks = [];
  const PLACEHOLDER_PREFIX = '__MATH_BLOCK_';
  const PLACEHOLDER_SUFFIX = '__';

  // Extract and protect math formulas
  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
  });

  // Process escape sequences on non-math content
  processedText = processedText.replace(/\\n/g, '\n')
                               .replace(/\\t/g, '\t')
                               .replace(/\\r/g, '\r');

  // Restore math formulas
  processedText = processedText.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index)];
    }
  );

  return processedText;
}

// Small wrapper to keep markdown behavior consistent in one place
const Markdown = ({ children, className }) => {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

// Format "Claude AI usage limit reached|<epoch>" into a local time string
function formatUsageLimitText(text) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000; // seconds → ms
      const reset = new Date(timestampMs);

      // Time HH:mm in local time
      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(reset);

      // Human-readable timezone: GMT±HH[:MM] (City)
      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      // Readable date like "8 Jun 2025"
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}

// Safe localStorage utility to handle quota exceeded errors
const safeLocalStorage = {
  setItem: (key, value) => {
    try {
      // For chat messages, implement compression and size limits
      if (key.startsWith('chat_messages_') && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          // Limit to last 50 messages to prevent storage bloat
          if (Array.isArray(parsed) && parsed.length > 50) {
            console.warn(`Truncating chat history for ${key} from ${parsed.length} to 50 messages`);
            const truncated = parsed.slice(-50);
            value = JSON.stringify(truncated);
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }
      
      localStorage.setItem(key, value);
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');
        // Clear old chat messages to free up space
        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter(k => k.startsWith('chat_messages_')).sort();
        
        // Remove oldest chat data first, keeping only the 3 most recent projects
        if (chatKeys.length > 3) {
          chatKeys.slice(0, chatKeys.length - 3).forEach(k => {
            localStorage.removeItem(k);
            console.log(`Removed old chat data: ${k}`);
          });
        }
        
        // If still failing, clear draft inputs too
        const draftKeys = keys.filter(k => k.startsWith('draft_input_'));
        draftKeys.forEach(k => {
          localStorage.removeItem(k);
        });
        
        // Try again with reduced data
        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
          // Last resort: Try to save just the last 10 messages
          if (key.startsWith('chat_messages_') && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed) && parsed.length > 10) {
                const minimal = parsed.slice(-10);
                localStorage.setItem(key, JSON.stringify(minimal));
                console.warn('Saved only last 10 messages due to quota constraints');
              }
            } catch (finalError) {
              console.error('Final save attempt failed:', finalError);
            }
          }
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  }
};

// Common markdown components to ensure consistent rendering (tables, inline code, links, etc.)
const markdownComponents = {
  code: ({ node, inline, className, children, ...props }) => {
    const [copied, setCopied] = React.useState(false);
    const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
    const looksMultiline = /[\r\n]/.test(raw);
    const inlineDetected = inline || (node && node.type === 'inlineCode');
    const shouldInline = inlineDetected || !looksMultiline; // fallback to inline if single-line
    
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
                // 立即移除焦点,避免焦点状态样式
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
  },
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
  img: ({ src, alt }) => {
    // Handle tool result images that have absolute file paths
    // These need to be fetched with authentication
    const [blobUrl, setBlobUrl] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState(false);

    React.useEffect(() => {
      // Check if this is a temporary image path
      if (!src || !src.includes('.tmp/images/')) {
        // Regular image, use as-is (e.g., base64 data URLs)
        setBlobUrl(src);
        setLoading(false);
        return;
      }

      // Fetch the image with authentication
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

      // Cleanup blob URL
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
  },
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

// Component to render user message content with image path detection
const UserMessageContent = memo(({ message, selectedProject }) => {
  const [imagePaths, setImagePaths] = useState([]);
  const [displayContent, setDisplayContent] = useState(message.content);
  const [imageBlobs, setImageBlobs] = useState({});

  useEffect(() => {
    // Parse image paths from content like:
    // "[Images provided at the following paths:]\n1. /path/to/image.png"
    // Format from claude-sdk.js: `\n\n[Images provided at the following paths:]\n${paths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    const content = message.content || '';
    
    // Match the entire image section including the leading newlines
    const imagePathRegex = /\n?\n?\[Images provided at the following paths:\]\n([\s\S]*?)$/;
    const match = content.match(imagePathRegex);
    
    if (match) {
      // Extract paths from format "1. /path/to/image.png"
      const pathsText = match[1];
      // Find all absolute paths in the text
      const pathMatches = pathsText.match(/\/[^\s\n]+/g) || [];
      const paths = pathMatches.filter(p => p.includes('.tmp/images/'));
      
      console.log('[UserMessageContent] Found image paths:', paths);
      
      setImagePaths(paths);
      // Remove the image paths section from display content
      setDisplayContent(content.replace(match[0], '').trim());
    } else {
      setImagePaths([]);
      setDisplayContent(content);
    }
  }, [message.content]);

  // Fetch images with authentication and create blob URLs
  useEffect(() => {
    if (imagePaths.length === 0) return;

    const loadImages = async () => {
      const blobs = {};
      for (const imagePath of imagePaths) {
        try {
          const response = await authenticatedFetch(`/api/temp-image?path=${encodeURIComponent(imagePath)}`);
          if (response.ok) {
            const blob = await response.blob();
            blobs[imagePath] = URL.createObjectURL(blob);
          } else {
            console.error(`Failed to load image ${imagePath}:`, response.status);
          }
        } catch (error) {
          console.error(`Error loading image ${imagePath}:`, error);
        }
      }
      setImageBlobs(blobs);
    };

    loadImages();

    // Cleanup blob URLs on unmount
    return () => {
      Object.values(imageBlobs).forEach(url => URL.revokeObjectURL(url));
    };
  }, [imagePaths]);

  // Build image URLs for paths (use temp-image API for .tmp/images paths)
  const getImageUrl = (imagePath) => {
    return imageBlobs[imagePath] || '';
  };

  return (
    <>
      <div className="text-sm whitespace-pre-wrap break-words">
        {displayContent}
      </div>
      {/* Show images from message.images (newly uploaded) */}
      {message.images && message.images.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {message.images.map((img, idx) => (
            <img
              key={idx}
              src={img.data}
              alt={img.name}
              className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(img.data, '_blank')}
            />
          ))}
        </div>
      )}
      {/* Show images from parsed paths (from history) */}
      {imagePaths.length > 0 && !message.images?.length && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {imagePaths.map((imagePath, idx) => {
            const blobUrl = imageBlobs[imagePath];
            // Only render if blob URL is ready
            if (!blobUrl) return null;
            
            return (
              <img
                key={idx}
                src={blobUrl}
                alt={`Image ${idx + 1}`}
                className="rounded-lg max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity bg-blue-500/20"
                onClick={() => window.open(blobUrl, '_blank')}
              />
            );
          })}
        </div>
      )}
    </>
  );
});

// ============================================================================
// Image Preview Component (Reusable)
// ============================================================================

/**
 * Inline image preview component for tool results
 * @param {string} base64Data - Base64 data URL
 * @param {Function} onClick - Click handler for full-screen preview
 */
const InlineImagePreview = memo(({ base64Data, onClick }) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <span className="font-medium">Image Preview</span>
    </div>
    <img
      src={base64Data}
      alt="Tool result preview"
      className="rounded-lg max-w-full max-h-96 h-auto cursor-pointer hover:opacity-90 transition-opacity border border-green-200 dark:border-green-700"
      onClick={onClick}
    />
  </div>
));

InlineImagePreview.displayName = 'InlineImagePreview';

// Memoized message component to prevent unnecessary re-renders
const MessageComponent = memo(({ message, index, prevMessage, createDiff, onFileOpen, onShowSettings, autoExpandTools, showRawParameters, showThinking, selectedProject, setImagePreview, setToolResultModal, onEditMessage }) => {
  const isGrouped = prevMessage && prevMessage.type === message.type &&
                   ((prevMessage.type === 'assistant') ||
                    (prevMessage.type === 'user') ||
                    (prevMessage.type === 'tool') ||
                    (prevMessage.type === 'error'));
  const messageRef = React.useRef(null);
  const [isExpanded, setIsExpanded] = React.useState(false);
  React.useEffect(() => {
    if (!autoExpandTools || !messageRef.current || !message.isToolUse) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isExpanded) {
            setIsExpanded(true);
            // Find all details elements and open them
            const details = messageRef.current.querySelectorAll('details');
            details.forEach(detail => {
              detail.open = true;
            });
          }
        });
      },
      { threshold: 0.1 }
    );
    
    observer.observe(messageRef.current);
    
    return () => {
      if (messageRef.current) {
        observer.unobserve(messageRef.current);
      }
    };
  }, [autoExpandTools, isExpanded, message.isToolUse]);

  return (
    <div
      ref={messageRef}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User message bubble on the right */
        <div className="flex flex-col items-end w-full sm:w-auto sm:max-w-[85%] md:max-w-2xl lg:max-w-3xl xl:max-w-4xl group/usermsg">
          <div className="flex items-end gap-2 w-full justify-end">
            {/* Edit button - appears on hover */}
            {onEditMessage && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEditMessage(index);
                }}
                className="opacity-0 group-hover/usermsg:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 flex-shrink-0 self-end mb-2"
                title="Edit message"
                aria-label="Edit message"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            <div className="bg-blue-600 text-white rounded-2xl rounded-br-md px-3 sm:px-4 py-2 shadow-sm flex-1 sm:flex-initial">
              <UserMessageContent message={message} selectedProject={selectedProject} />
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 w-full text-right">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full max-w-full">
          
          <div className="w-full">
            
            {message.isToolUse && !['Read', 'TodoWrite', 'TodoRead'].includes(message.toolName) ? (
              (() => {
                // Minimize Grep and Glob tools since they happen frequently
                const isSearchTool = ['Grep', 'Glob'].includes(message.toolName);

                if (isSearchTool) {
                  return (
                    <>
                      <div className="group relative bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-blue-400 dark:border-blue-500 pl-3 py-2 my-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 flex-1 min-w-0">
                            <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <span className="font-medium flex-shrink-0">{message.toolName}</span>
                            <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">•</span>
                            {message.toolInput && (() => {
                              try {
                                const input = JSON.parse(message.toolInput);
                                return (
                                  <span className="font-mono truncate flex-1 min-w-0">
                                    {input.pattern && <span>pattern: <span className="text-blue-600 dark:text-blue-400">{input.pattern}</span></span>}
                                    {input.path && <span className="ml-2">in: {input.path}</span>}
                                  </span>
                                );
                              } catch (e) {
                                return null;
                              }
                            })()}
                          </div>
                          {message.toolResult && (
                            <button
                              onClick={() => setToolResultModal({ message, toolName: message.toolName })}
                              className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors flex items-center gap-1"
                            >
                              <span>results</span>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  );
                }

                // Full display for other tools
                return (
              <div className="group relative bg-gradient-to-br from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-100/30 dark:border-blue-800/30 rounded-lg p-3 mb-2">
                {/* Decorative gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/3 to-indigo-500/3 dark:from-blue-400/3 dark:to-indigo-400/3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                <div className="relative flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-400/20">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {/* Subtle pulse animation */}
                      <div className="absolute inset-0 rounded-lg bg-blue-500 dark:bg-blue-400 animate-pulse opacity-20"></div>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">
                        {message.toolName}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {message.toolId}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {message.toolResult && (
                      <button
                        onClick={() => setToolResultModal({ message, toolName: message.toolName })}
                        className="px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium transition-colors rounded-lg flex items-center gap-1.5 border border-blue-200 dark:border-blue-800"
                        title="View tool result"
                      >
                        <span>results</span>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    )}
                    {onShowSettings && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowSettings();
                        }}
                        className="p-2 rounded-lg hover:bg-white/60 dark:hover:bg-gray-800/60 transition-all duration-200 group/btn backdrop-blur-sm"
                        title="Tool Settings"
                      >
                        <svg className="w-4 h-4 text-gray-600 dark:text-gray-400 group-hover/btn:text-blue-600 dark:group-hover/btn:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                {message.toolInput && message.toolName === 'Edit' && (() => {
                  try {
                    const input = JSON.parse(message.toolInput);
                    if (input.file_path && input.old_string && input.new_string) {
                      return (
                        <details className="relative mt-3 group/details" open={autoExpandTools}>
                          <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                            <svg className="w-4 h-4 transition-transform duration-200 group-open/details:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            <span className="flex items-center gap-2">
                              <span>View edit diff for</span>
                            </span> 
                            <button
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!onFileOpen) return;

                                try {
                                  // Fetch the current file (after the edit)
                                  const response = await api.readFile(selectedProject?.name, input.file_path);
                                  const data = await response.json();

                                  if (!response.ok || data.error) {
                                    console.error('Failed to fetch file:', data.error);
                                    onFileOpen(input.file_path);
                                    return;
                                  }

                                  const currentContent = data.content || '';

                                  // Reverse apply the edit: replace new_string back to old_string to get the file BEFORE the edit
                                  const oldContent = currentContent.replace(input.new_string, input.old_string);

                                  // Pass the full file before and after the edit
                                  onFileOpen(input.file_path, {
                                    old_string: oldContent,
                                    new_string: currentContent
                                  });
                                } catch (error) {
                                  console.error('Error preparing diff:', error);
                                  onFileOpen(input.file_path);
                                }
                              }}
                              className="px-2.5 py-1 rounded-md bg-white/60 dark:bg-gray-800/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-mono text-xs font-medium transition-all duration-200 shadow-sm"
                            >
                              {input.file_path.split('/').pop()}
                            </button>
                          </summary>
                          <div className="mt-3 pl-6">
                            <div className="bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden shadow-sm">
                              <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/80 dark:to-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/60 backdrop-blur-sm">
                                <button
                                  onClick={async () => {
                                    if (!onFileOpen) return;

                                    try {
                                      // Fetch the current file (after the edit)
                                      const response = await api.readFile(selectedProject?.name, input.file_path);
                                      const data = await response.json();

                                      if (!response.ok || data.error) {
                                        console.error('Failed to fetch file:', data.error);
                                        onFileOpen(input.file_path);
                                        return;
                                      }

                                      const currentContent = data.content || '';
                                      // Reverse apply the edit: replace new_string back to old_string
                                      const oldContent = currentContent.replace(input.new_string, input.old_string);

                                      // Pass the full file before and after the edit
                                      onFileOpen(input.file_path, {
                                        old_string: oldContent,
                                        new_string: currentContent
                                      });
                                    } catch (error) {
                                      console.error('Error preparing diff:', error);
                                      onFileOpen(input.file_path);
                                    }
                                  }}
                                  className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer font-medium transition-colors"
                                >
                                  {input.file_path}
                                </button>
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-gray-100 dark:bg-gray-700/50 rounded">
                                  Diff
                                </span>
                              </div>
                              <div className="text-xs font-mono">
                                {createDiff(input.old_string, input.new_string).map((diffLine, i) => (
                                  <div key={i} className="flex">
                                    <span className={`w-8 text-center border-r ${
                                      diffLine.type === 'removed' 
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                        : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                    }`}>
                                      {diffLine.type === 'removed' ? '-' : '+'}
                                    </span>
                                    <span className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                                      diffLine.type === 'removed'
                                        ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                                        : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                                    }`}>
                                      {diffLine.content}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {showRawParameters && (
                              <details className="relative mt-3 pl-6 group/raw" open={autoExpandTools}>
                                <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                  <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                  View raw parameters
                                </summary>
                                <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                                  {message.toolInput}
                                </pre>
                              </details>
                            )}
                          </div>
                        </details>
                      );
                    }
                  } catch (e) {
                    // Fall back to raw display if parsing fails
                  }
                  return (
                    <details className="relative mt-3 group/params" open={autoExpandTools}>
                      <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                        <svg className="w-4 h-4 transition-transform duration-200 group-open/params:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        View input parameters
                      </summary>
                      <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                        {message.toolInput}
                      </pre>
                    </details>
                  );
                })()}
                {message.toolInput && message.toolName !== 'Edit' && (() => {
                  // Debug log to see what we're dealing with
                  
                  // Special handling for Write tool
                  if (message.toolName === 'Write') {
                    try {
                      let input;
                      // Handle both JSON string and already parsed object
                      if (typeof message.toolInput === 'string') {
                        input = JSON.parse(message.toolInput);
                      } else {
                        input = message.toolInput;
                      }
                      
                      
                      if (input.file_path && input.content !== undefined) {
                        return (
                          <details className="relative mt-3 group/details" open={autoExpandTools}>
                            <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                              <svg className="w-4 h-4 transition-transform duration-200 group-open/details:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              <span className="flex items-center gap-2">
                                <span className="text-lg leading-none">📄</span>
                                <span>Creating new file:</span>
                              </span>
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!onFileOpen) return;

                                  try {
                                    // Fetch the written file from disk
                                    const response = await api.readFile(selectedProject?.name, input.file_path);
                                    const data = await response.json();

                                    const newContent = (response.ok && !data.error) ? data.content || '' : input.content || '';

                                    // New file: old_string is empty, new_string is the full file
                                    onFileOpen(input.file_path, {
                                      old_string: '',
                                      new_string: newContent
                                    });
                                  } catch (error) {
                                    console.error('Error preparing diff:', error);
                                    // Fallback to tool input content
                                    onFileOpen(input.file_path, {
                                      old_string: '',
                                      new_string: input.content || ''
                                    });
                                  }
                                }}
                                className="px-2.5 py-1 rounded-md bg-white/60 dark:bg-gray-800/60 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 font-mono text-xs font-medium transition-all duration-200 shadow-sm"
                              >
                                {input.file_path.split('/').pop()}
                              </button>
                            </summary>
                            <div className="mt-3 pl-6">
                              <div className="bg-white dark:bg-gray-900/50 border border-gray-200/60 dark:border-gray-700/60 rounded-lg overflow-hidden shadow-sm">
                                <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-gray-50 to-gray-100/50 dark:from-gray-800/80 dark:to-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/60 backdrop-blur-sm">
                                  <button
                                    onClick={async () => {
                                      if (!onFileOpen) return;

                                      try {
                                        // Fetch the written file from disk
                                        const response = await api.readFile(selectedProject?.name, input.file_path);
                                        const data = await response.json();

                                        const newContent = (response.ok && !data.error) ? data.content || '' : input.content || '';

                                        // New file: old_string is empty, new_string is the full file
                                        onFileOpen(input.file_path, {
                                          old_string: '',
                                          new_string: newContent
                                        });
                                      } catch (error) {
                                        console.error('Error preparing diff:', error);
                                        // Fallback to tool input content
                                        onFileOpen(input.file_path, {
                                          old_string: '',
                                          new_string: input.content || ''
                                        });
                                      }
                                    }}
                                    className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer font-medium transition-colors"
                                  >
                                    {input.file_path}
                                  </button>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                    New File
                                  </span>
                                </div>
                                <div className="text-xs font-mono">
                                  {createDiff('', input.content).map((diffLine, i) => (
                                    <div key={i} className="flex">
                                      <span className={`w-8 text-center border-r ${
                                        diffLine.type === 'removed' 
                                          ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                                          : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                                      }`}>
                                        {diffLine.type === 'removed' ? '-' : '+'}
                                      </span>
                                      <span className={`px-2 py-0.5 flex-1 whitespace-pre-wrap ${
                                        diffLine.type === 'removed'
                                          ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                                          : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                                      }`}>
                                        {diffLine.content}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {showRawParameters && (
                                <details className="relative mt-3 pl-6 group/raw" open={autoExpandTools}>
                                  <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                    <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    View raw parameters
                                  </summary>
                                  <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                                    {message.toolInput}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for TodoWrite tool
                  if (message.toolName === 'TodoWrite') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.todos && Array.isArray(input.todos)) {
                        return (
                          <details className="relative mt-3 group/todo" open={autoExpandTools}>
                            <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                              <svg className="w-4 h-4 transition-transform duration-200 group-open/todo:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              <span className="flex items-center gap-2">
                                <span className="text-lg leading-none">✓</span>
                                <span>Updating Todo List</span>
                              </span>
                            </summary>
                            <div className="mt-3">
                              <TodoList todos={input.todos} />
                              {showRawParameters && (
                                <details className="relative mt-3 group/raw" open={autoExpandTools}>
                                  <summary className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                                    <svg className="w-3 h-3 transition-transform duration-200 group-open/raw:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    View raw parameters
                                  </summary>
                                  <pre className="mt-2 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg overflow-x-auto text-gray-700 dark:text-gray-300 font-mono">
                                    {message.toolInput}
                                  </pre>
                                </details>
                              )}
                            </div>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for Bash tool
                  if (message.toolName === 'Bash') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      return (
                        <div className="my-2">
                          <div className="bg-gray-900 dark:bg-gray-950 rounded-md px-3 py-2 font-mono text-sm">
                            <span className="text-green-400">$</span>
                            <span className="text-gray-100 ml-2">{input.command}</span>
                          </div>
                          {input.description && (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 italic ml-1">
                              {input.description}
                            </div>
                          )}
                        </div>
                      );
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for Read tool
                  if (message.toolName === 'Read') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.file_path) {
                        const filename = input.file_path.split('/').pop();
                        
                        return (
                          <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                            Read{' '}
                            <button
                              onClick={() => {
                                // Check if it's an image file
                                const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(input.file_path);
                                
                                if (isImage && message.toolResult?.content) {
                                  // Use cached base64 data for images
                                  const base64Data = extractBase64FromContent(message.toolResult.content);
                                  if (base64Data) {
                                    setImagePreview({ url: base64Data, filename });
                                    return;
                                  }
                                }
                                
                                // For text files, show in modal using cached content
                                setToolResultModal({ message, toolName: message.toolName });
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline font-mono"
                            >
                              {filename}
                            </button>
                          </div>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Special handling for exit_plan_mode tool
                  if (message.toolName === 'exit_plan_mode') {
                    try {
                      const input = JSON.parse(message.toolInput);
                      if (input.plan) {
                        // Replace escaped newlines with actual newlines
                        const planContent = input.plan.replace(/\\n/g, '\n');
                        return (
                          <details className="mt-2" open={autoExpandTools}>
                            <summary className="text-sm text-blue-700 dark:text-blue-300 cursor-pointer hover:text-blue-800 dark:hover:text-blue-200 flex items-center gap-2">
                              <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                              📋 View implementation plan
                            </summary>
                            <Markdown className="mt-3 prose prose-sm max-w-none dark:prose-invert">
                              {planContent}
                            </Markdown>
                          </details>
                        );
                      }
                    } catch (e) {
                      // Fall back to regular display
                    }
                  }
                  
                  // Regular tool input display for other tools
                  return (
                    <details className="relative mt-3 group/params" open={autoExpandTools}>
                      <summary className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 p-2.5 rounded-lg hover:bg-white/50 dark:hover:bg-gray-800/50">
                        <svg className="w-4 h-4 transition-transform duration-200 group-open/params:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        View input parameters
                      </summary>
                      <pre className="mt-3 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/60 dark:border-gray-700/60 p-3 rounded-lg whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono">
                        {message.toolInput}
                      </pre>
                    </details>
                  );
                })()}
                
                {/* Tool Result Section */}
                {message.toolResult && (() => {
                  // Hide tool results for Edit/Write/Bash unless there's an error
                  const shouldHideResult = !message.toolResult.isError &&
                    (message.toolName === 'Edit' || message.toolName === 'Write' || message.toolName === 'ApplyPatch' || message.toolName === 'Bash');

                  if (shouldHideResult) {
                    return null;
                  }

                  return (
                  <div
                    id={`tool-result-${message.toolId}`}
                    className={`relative mt-4 p-4 rounded-lg border backdrop-blur-sm scroll-mt-4 ${
                    message.toolResult.isError
                      ? 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border-red-200/60 dark:border-red-800/60'
                      : 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200/60 dark:border-green-800/60'
                  }`}>
                    {/* Decorative gradient overlay */}
                    <div className={`absolute inset-0 rounded-lg opacity-50 ${
                      message.toolResult.isError
                        ? 'bg-gradient-to-br from-red-500/5 to-rose-500/5 dark:from-red-400/5 dark:to-rose-400/5'
                        : 'bg-gradient-to-br from-green-500/5 to-emerald-500/5 dark:from-green-400/5 dark:to-emerald-400/5'
                    }`}></div>

                    <div className="relative flex items-center gap-2.5 mb-3">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shadow-md ${
                        message.toolResult.isError
                          ? 'bg-gradient-to-br from-red-500 to-rose-600 dark:from-red-400 dark:to-rose-500 shadow-red-500/20'
                          : 'bg-gradient-to-br from-green-500 to-emerald-600 dark:from-green-400 dark:to-emerald-500 shadow-green-500/20'
                      }`}>
                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {message.toolResult.isError ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          )}
                        </svg>
                      </div>
                      <span className={`text-sm font-semibold ${
                        message.toolResult.isError
                          ? 'text-red-800 dark:text-red-200'
                          : 'text-green-800 dark:text-green-200'
                      }`}>
                        {message.toolResult.isError ? 'Tool Error' : 'Tool Result'}
                      </span>
                    </div>

                    <div className={`relative text-sm ${
                      message.toolResult.isError
                        ? 'text-red-900 dark:text-red-100'
                        : 'text-green-900 dark:text-green-100'
                    }`}>
                      {(() => {
                        // Handle array content (e.g., [{type: 'image', source: {...}}])
                        // Support both data structures: legacy (toolResult.content) and new (toolResult.toolUseResult.content)
                        const rawContent = message.toolResult?.toolUseResult?.content || message.toolResult?.content;
                        const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
                        
                        // Get structured tool result data if available
                        const toolData = message.toolResult?.toolUseResult;
                        
                        // Special handling for Read tool with image files (base64 data)
                        if (message.toolName === 'Read' && !message.toolResult.isError) {
                          const base64Data = extractBase64FromContent(rawContent);
                          if (base64Data) {
                            return (
                              <InlineImagePreview
                                base64Data={base64Data}
                                onClick={() => setImagePreview({ url: base64Data, filename: 'image' })}
                              />
                            );
                          }
                          
                          // Try to get content from structured result first, then fall back to rawContent
                          const readContent = toolData?.content || rawContent;
                          
                          // Use structured tool result if available (renderer info from CLI) or plain content
                          if (readContent && (toolData?.renderer?.type === 'code' || typeof readContent === 'string')) {
                            const language = toolData?.renderer?.context?.language || 'text';
                            const title = stripAnsi(toolData?.title || 'File content');
                            return (
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="font-medium">{title}</span>
                                </div>
                                <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
                                  <SyntaxHighlighter
                                    language={language}
                                    style={vscDarkPlus}
                                    customStyle={{
                                      margin: 0,
                                      padding: '1rem',
                                      fontSize: '0.75rem',
                                      lineHeight: '1.5',
                                      maxHeight: '24rem',
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
                        
                        // Special handling for TodoWrite/TodoRead results
                        if ((message.toolName === 'TodoWrite' || message.toolName === 'TodoRead') &&
                            (content.includes('Todos have been modified successfully') || 
                             content.includes('Todo list') || 
                             (content.startsWith('[') && content.includes('"content"') && content.includes('"status"')))) {
                          try {
                            // Try to parse if it looks like todo JSON data
                            let todos = null;
                            if (content.startsWith('[')) {
                              todos = JSON.parse(content);
                            } else if (content.includes('Todos have been modified successfully')) {
                              // For TodoWrite success messages, we don't have the data in the result
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="font-medium">Todo list has been updated successfully</span>
                                  </div>
                                </div>
                              );
                            }
                            
                            if (todos && Array.isArray(todos)) {
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="font-medium">Current Todo List</span>
                                  </div>
                                  <TodoList todos={todos} isResult={true} />
                                </div>
                              );
                            }
                          } catch (e) {
                            // Fall through to regular handling
                          }
                        }

                        // Special handling for exit_plan_mode tool results
                        if (message.toolName === 'exit_plan_mode') {
                          try {
                            // The content should be JSON with a "plan" field
                            const parsed = JSON.parse(content);
                            if (parsed.plan) {
                              // Replace escaped newlines with actual newlines
                              const planContent = parsed.plan.replace(/\\n/g, '\n');
                              return (
                                <div>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="font-medium">Implementation Plan</span>
                                  </div>
                                  <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                                    {planContent}
                                  </Markdown>
                                </div>
                              );
                            }
                          } catch (e) {
                            // Fall through to regular handling
                          }
                        }

                        // Special handling for Grep/Glob results with structured data
                        if ((message.toolName === 'Grep' || message.toolName === 'Glob') && message.toolResult?.toolUseResult) {
                          const toolData = message.toolResult.toolUseResult;

                          // Handle content mode - display full search results with content
                          if (toolData.content && Array.isArray(toolData.content) && toolData.content.length > 0) {
                            const cleanContent = toolData.content.map(line => stripAnsi(line));
                            const title = stripAnsi(toolData.title || `Found ${toolData.content.length} lines`);
                            return (
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="font-medium">{title}</span>
                                </div>
                                <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                                  <pre className="p-4 text-xs font-mono">
                                    <code className="text-gray-100 dark:text-gray-200 whitespace-pre">
                                      {cleanContent.join('\n')}
                                    </code>
                                  </pre>
                                </div>
                              </div>
                            );
                          }

                          // Handle files_with_matches mode or any tool result with filenames array
                          if (toolData.filenames && Array.isArray(toolData.filenames) && toolData.filenames.length > 0) {
                            return (
                              <div>
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="font-medium">
                                    Found {toolData.numFiles || toolData.filenames.length} {(toolData.numFiles === 1 || toolData.filenames.length === 1) ? 'file' : 'files'}
                                  </span>
                                </div>
                                <div className="space-y-1 max-h-96 overflow-y-auto">
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
                                          }
                                        }}
                                        className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-green-100/50 dark:hover:bg-green-800/20 cursor-pointer transition-colors"
                                      >
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <div className="flex-1 min-w-0">
                                          <div className="font-mono text-sm font-medium text-green-800 dark:text-green-200 truncate group-hover:text-green-900 dark:group-hover:text-green-100">
                                            {fileName}
                                          </div>
                                          <div className="font-mono text-xs text-green-600/70 dark:text-green-400/70 truncate">
                                            {dirPath}
                                          </div>
                                        </div>
                                        <svg className="w-4 h-4 text-green-600 dark:text-green-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                        }

                        // Special handling for interactive prompts
                        if (content.includes('Do you want to proceed?') && message.toolName === 'Bash') {
                          const lines = content.split('\n');
                          const promptIndex = lines.findIndex(line => line.includes('Do you want to proceed?'));
                          const beforePrompt = lines.slice(0, promptIndex).join('\n');
                          const promptLines = lines.slice(promptIndex);
                          
                          // Extract the question and options
                          const questionLine = promptLines.find(line => line.includes('Do you want to proceed?')) || '';
                          const options = [];
                          
                          // Parse numbered options (1. Yes, 2. No, etc.)
                          promptLines.forEach(line => {
                            const optionMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
                            if (optionMatch) {
                              options.push({
                                number: optionMatch[1],
                                text: optionMatch[2].trim()
                              });
                            }
                          });
                          
                          // Find which option was selected (usually indicated by "> 1" or similar)
                          const selectedMatch = content.match(/>\s*(\d+)/);
                          const selectedOption = selectedMatch ? selectedMatch[1] : null;
                          
                          return (
                            <div className="space-y-3">
                              {beforePrompt && (
                                <div className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 font-mono text-xs overflow-x-auto">
                                  <pre className="whitespace-pre-wrap break-words">{beforePrompt}</pre>
                                </div>
                              )}
                              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <div className="flex-1">
                                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-2">
                                      Interactive Prompt
                                    </h4>
                                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                                      {questionLine}
                                    </p>
                                    
                                    {/* Option buttons */}
                                    <div className="space-y-2 mb-4">
                                      {options.map((option) => (
                                        <button
                                          key={option.number}
                                          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                            selectedOption === option.number
                                              ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                              : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-sm'
                                          } ${
                                            selectedOption ? 'cursor-default' : 'cursor-not-allowed opacity-75'
                                          }`}
                                          disabled
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                              selectedOption === option.number
                                                ? 'bg-white/20'
                                                : 'bg-amber-100 dark:bg-amber-800/50'
                                            }`}>
                                              {option.number}
                                            </span>
                                            <span className="text-sm sm:text-base font-medium flex-1">
                                              {option.text}
                                            </span>
                                            {selectedOption === option.number && (
                                              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                              </svg>
                                            )}
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                    
                                    {selectedOption && (
                                      <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                                        <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                                          ✓ Claude selected option {selectedOption}
                                        </p>
                                        <p className="text-amber-800 dark:text-amber-200 text-xs">
                                          In the CLI, you would select this option interactively using arrow keys or by typing the number.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        
                        const fileEditMatch = content.match(/The file (.+?) has been updated\./);
                        if (fileEditMatch) {
                          return (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">File updated successfully</span>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!onFileOpen) return;

                                  // Fetch FULL file content with diff from git
                                  try {
                                    const response = await authenticatedFetch(`/api/git/file-with-diff?project=${encodeURIComponent(selectedProject?.name)}&file=${encodeURIComponent(fileEditMatch[1])}`);
                                    const data = await response.json();

                                    if (!data.error && data.oldContent !== undefined && data.currentContent !== undefined) {
                                      onFileOpen(fileEditMatch[1], {
                                        old_string: data.oldContent || '',
                                        new_string: data.currentContent || ''
                                      });
                                    } else {
                                      onFileOpen(fileEditMatch[1]);
                                    }
                                  } catch (error) {
                                    console.error('Error fetching file diff:', error);
                                    onFileOpen(fileEditMatch[1]);
                                  }
                                }}
                                className="text-xs font-mono bg-green-100 dark:bg-green-800/30 px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline cursor-pointer"
                              >
                                {fileEditMatch[1]}
                              </button>
                            </div>
                          );
                        }
                        
                        // Handle Write tool output for file creation
                        const fileCreateMatch = content.match(/(?:The file|File) (.+?) has been (?:created|written)(?: successfully)?\.?/);
                        if (fileCreateMatch) {
                          return (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">File created successfully</span>
                              </div>
                              <button
                                onClick={async () => {
                                  if (!onFileOpen) return;

                                  // Fetch FULL file content with diff from git
                                  try {
                                    const response = await authenticatedFetch(`/api/git/file-with-diff?project=${encodeURIComponent(selectedProject?.name)}&file=${encodeURIComponent(fileCreateMatch[1])}`);
                                    const data = await response.json();

                                    if (!data.error && data.oldContent !== undefined && data.currentContent !== undefined) {
                                      onFileOpen(fileCreateMatch[1], {
                                        old_string: data.oldContent || '',
                                        new_string: data.currentContent || ''
                                      });
                                    } else {
                                      onFileOpen(fileCreateMatch[1]);
                                    }
                                  } catch (error) {
                                    console.error('Error fetching file diff:', error);
                                    onFileOpen(fileCreateMatch[1]);
                                  }
                                }}
                                className="text-xs font-mono bg-green-100 dark:bg-green-800/30 px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline cursor-pointer"
                              >
                                {fileCreateMatch[1]}
                              </button>
                            </div>
                          );
                        }
                        
                        // Special handling for Write tool - hide content if it's just the file content
                        if (message.toolName === 'Write' && !message.toolResult.isError) {
                          // For Write tool, the diff is already shown in the tool input section
                          // So we just show a success message here
                          return (
                            <div className="text-green-700 dark:text-green-300">
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="font-medium">File written successfully</span>
                              </div>
                              <p className="text-xs mt-1 text-green-600 dark:text-green-400">
                                The file content is displayed in the diff view above
                              </p>
                            </div>
                          );
                        }
                        
                        if (content.includes('cat -n') && content.includes('→')) {
                          return (
                            <details open={autoExpandTools}>
                              <summary className="text-sm text-green-700 dark:text-green-300 cursor-pointer hover:text-green-800 dark:hover:text-green-200 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                View file content
                              </summary>
                              <div className="mt-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <div className="text-xs font-mono p-3 whitespace-pre-wrap break-words overflow-hidden">
                                  {content}
                                </div>
                              </div>
                            </details>
                          );
                        }
                        
                        if (content.length > 300) {
                          return (
                            <details open={autoExpandTools}>
                              <summary className="text-sm text-green-700 dark:text-green-300 cursor-pointer hover:text-green-800 dark:hover:text-green-200 mb-2 flex items-center gap-2">
                                <svg className="w-4 h-4 transition-transform details-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                View full output ({content.length} chars)
                              </summary>
                              <Markdown className="mt-2 prose prose-sm max-w-none prose-green dark:prose-invert">
                                {content}
                              </Markdown>
                            </details>
                          );
                        }
                        
                        return (
                          <Markdown className="prose prose-sm max-w-none prose-green dark:prose-invert">
                            {content}
                          </Markdown>
                        );
                      })()}
                    </div>
                  </div>
                  );
                })()}
              </div>
                );
              })()
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-900 dark:text-amber-100 text-base mb-3">
                      Interactive Prompt
                    </h4>
                    {(() => {
                      const lines = message.content.split('\n').filter(line => line.trim());
                      const questionLine = lines.find(line => line.includes('?')) || lines[0] || '';
                      const options = [];
                      
                      // Parse the menu options
                      lines.forEach(line => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });
                      
                      return (
                        <>
                          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                            {questionLine}
                          </p>
                          
                          {/* Option buttons */}
                          <div className="space-y-2 mb-4">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                                  option.isSelected
                                    ? 'bg-amber-600 dark:bg-amber-700 text-white border-amber-600 dark:border-amber-700 shadow-md'
                                    : 'bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-100 border-amber-300 dark:border-amber-700'
                                } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                    option.isSelected
                                      ? 'bg-white/20'
                                      : 'bg-amber-100 dark:bg-amber-800/50'
                                  }`}>
                                    {option.number}
                                  </span>
                                  <span className="text-sm sm:text-base font-medium flex-1">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                          
                          <div className="bg-amber-100 dark:bg-amber-800/30 rounded-lg p-3">
                            <p className="text-amber-900 dark:text-amber-100 text-sm font-medium mb-1">
                              ⏳ Waiting for your response in the CLI
                            </p>
                            <p className="text-amber-800 dark:text-amber-200 text-xs">
                              Please select an option in your terminal where Claude is running.
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isToolUse && message.toolName === 'Read' ? (
              // Simple Read tool indicator
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.file_path) {
                    const filename = input.file_path.split('/').pop();
                    const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename);
                    
                    return (
                      <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          <span className="font-medium">Read</span>
                          <button
                            onClick={() => {
                              if (isImage) {
                                // For images, use cached base64 data
                                const base64Data = message.toolResult?.content 
                                  ? extractBase64FromContent(message.toolResult.content)
                                  : null;
                                
                                if (base64Data) {
                                  setImagePreview({ url: base64Data, filename });
                                }
                              } else {
                                // For text files, show in modal using cached content
                                setToolResultModal({ message, toolName: message.toolName });
                              }
                            }}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono transition-colors"
                          >
                            {filename}
                          </button>
                        </div>
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <span className="font-medium">Read file</span>
                      </div>
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoWrite' ? (
              // Simple TodoWrite tool indicator with tasks
              (() => {
                try {
                  const input = JSON.parse(message.toolInput);
                  if (input.todos && Array.isArray(input.todos)) {
                    return (
                      <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                        <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-2">
                          <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <span className="font-medium">Update todo list</span>
                        </div>
                        <TodoList todos={input.todos} />
                      </div>
                    );
                  }
                } catch (e) {
                  return (
                    <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <span className="font-medium">Update todo list</span>
                      </div>
                    </div>
                  );
                }
              })()
            ) : message.isToolUse && message.toolName === 'TodoRead' ? (
              // Simple TodoRead tool indicator
              <div className="bg-gray-50/50 dark:bg-gray-800/30 border-l-2 border-gray-400 dark:border-gray-500 pl-3 py-2 my-2">
                <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                  <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  <span className="font-medium">Read todo list</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {/* Thinking accordion for reasoning */}
                {showThinking && message.reasoning && (
                  <details className="mb-3">
                    <summary className="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 font-medium">
                      💭 Thinking...
                    </summary>
                    <div className="mt-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600 italic text-gray-600 dark:text-gray-400 text-sm">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </div>
                  </details>
                )}
                
                {(() => {
                  const content = formatUsageLimitText(String(message.content || ''));

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                      (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">JSON Response</span>
                          </div>
                          <div className="bg-gray-800 dark:bg-gray-900 border border-gray-600/30 dark:border-gray-700 rounded-lg overflow-hidden">
                            <pre className="p-4 overflow-x-auto">
                              <code className="text-gray-100 dark:text-gray-200 text-sm font-mono block whitespace-pre">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch (e) {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-gray">
                      {content}
                    </Markdown>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}
            
            <div className={`text-xs text-gray-500 dark:text-gray-400 mt-1 ${isGrouped ? 'opacity-0 group-hover:opacity-100' : ''}`}>
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ImageAttachment component for displaying image previews
const ImageAttachment = ({ file, onRemove, uploadProgress, error }) => {
  const [preview, setPreview] = useState(null);
  
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  
  return (
    <div className="relative group">
      <img src={preview} alt={file.name} className="w-20 h-20 object-cover rounded" />
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-white text-xs">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

// ChatInterface: Main chat component with Session Protection System integration
// 
// Session Protection System prevents automatic project updates from interrupting active conversations:
// - onSessionActive: Called when user sends message to mark session as protected
// - onSessionInactive: Called when conversation completes/aborts to re-enable updates
// - onReplaceTemporarySession: Called to replace temporary session ID with real WebSocket session ID
//
// This ensures uninterrupted chat experience by pausing sidebar refreshes during conversations.
function ChatInterface({ selectedProject, selectedSession, ws, sendMessage, messages, onFileOpen, onInputFocusChange, onSessionActive, onSessionInactive, onSessionProcessing, onSessionNotProcessing, onSessionCompleted, processingSessions, onReplaceTemporarySession, onNavigateToSession, onShowSettings, autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter, externalMessageUpdate, onToggleQuickSettings }) {
  const [input, setInput] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      return safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
    }
    return '';
  });
  const [chatMessages, setChatMessages] = useState(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(selectedSession?.id || null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [sessionMessages, setSessionMessages] = useState([]);
  
  // Edit message states
  const [editingMessageIndex, setEditingMessageIndex] = useState(null);
  const [originalInput, setOriginalInput] = useState('');
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const isLoadingMoreMessagesRef = useRef(false); // Ref to immediately block duplicate scroll triggers
  const pendingScrollRestoreRef = useRef(null); // Pending scroll position to restore after loading more messages
  const [messagesOffset, setMessagesOffset] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const MESSAGES_PER_PAGE = 20;
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [permissionMode, setPermissionMode] = useState('default');
  const [attachedImages, setAttachedImages] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(new Map());
  const [imageErrors, setImageErrors] = useState(new Map());
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const inputContainerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isLoadingSessionRef = useRef(false); // Track session loading to prevent multiple scrolls
  // Streaming throttle buffers
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef(null);
  const commandQueryTimerRef = useRef(null);
  // Pending tool results queue (for handling race conditions)
  const pendingToolResultsRef = useRef(new Map());
  const [debouncedInput, setDebouncedInput] = useState('');
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);
  const [imagePreview, setImagePreview] = useState(null); // { url: string, filename: string }
  const [toolResultModal, setToolResultModal] = useState(null); // { message: object, toolName: string }
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [slashCommands, setSlashCommands] = useState([]);
  const [filteredCommands, setFilteredCommands] = useState([]);
  const [commandQuery, setCommandQuery] = useState('');
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const [tokenBudget, setTokenBudget] = useState(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(-1);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [visibleMessageCount, setVisibleMessageCount] = useState(100);
  const [claudeStatus, setClaudeStatus] = useState(null);
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('selected-provider') || 'claude';
  });
  const [cursorModel, setCursorModel] = useState(() => {
    return localStorage.getItem('cursor-model') || 'gpt-5';
  });
  const [codebuddyModel, setCodebuddyModel] = useState(() => {
    return localStorage.getItem('codebuddy-model') || 'default';
  });
  // Load permission mode for the current session
  useEffect(() => {
    if (selectedSession?.id) {
      const savedMode = localStorage.getItem(`permissionMode-${selectedSession.id}`);
      if (savedMode) {
        setPermissionMode(savedMode);
      } else {
        setPermissionMode('default');
      }
    }
  }, [selectedSession?.id]);

  // When selecting a session from Sidebar, auto-switch provider to match session's origin
  useEffect(() => {
    if (selectedSession && selectedSession.__provider && selectedSession.__provider !== provider) {
      setProvider(selectedSession.__provider);
      localStorage.setItem('selected-provider', selectedSession.__provider);
    }
  }, [selectedSession]);
  
  // Load Cursor default model from config
  useEffect(() => {
    if (provider === 'cursor') {
      authenticatedFetch('/api/cursor/config')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.config?.model?.modelId) {
          // Map Cursor model IDs to our simplified names
          const modelMap = {
            'gpt-5': 'gpt-5',
            'claude-4-sonnet': 'sonnet-4',
            'sonnet-4': 'sonnet-4',
            'claude-4-opus': 'opus-4.1',
            'opus-4.1': 'opus-4.1'
          };
          const mappedModel = modelMap[data.config.model.modelId] || data.config.model.modelId;
          if (!localStorage.getItem('cursor-model')) {
            setCursorModel(mappedModel);
          }
        }
      })
      .catch(err => console.error('Error loading Cursor config:', err));
    }
  }, [provider]);

  // Fetch slash commands on mount and when project changes
  useEffect(() => {
    const fetchCommands = async () => {
      if (!selectedProject) return;

      try {
        const response = await authenticatedFetch('/api/commands/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectPath: selectedProject.path
          })
        });

        if (!response.ok) {
          throw new Error('Failed to fetch commands');
        }

        const data = await response.json();

        // Combine built-in and custom commands
        const allCommands = [
          ...(data.builtIn || []).map(cmd => ({ ...cmd, type: 'built-in' })),
          ...(data.custom || []).map(cmd => ({ ...cmd, type: 'custom' }))
        ];

        setSlashCommands(allCommands);

        // Load command history from localStorage
        const historyKey = `command_history_${selectedProject.name}`;
        const history = safeLocalStorage.getItem(historyKey);
        if (history) {
          try {
            const parsedHistory = JSON.parse(history);
            // Sort commands by usage frequency
            const sortedCommands = allCommands.sort((a, b) => {
              const aCount = parsedHistory[a.name] || 0;
              const bCount = parsedHistory[b.name] || 0;
              return bCount - aCount;
            });
            setSlashCommands(sortedCommands);
          } catch (e) {
            console.error('Error parsing command history:', e);
          }
        }
      } catch (error) {
        console.error('Error fetching slash commands:', error);
        setSlashCommands([]);
      }
    };

    fetchCommands();
  }, [selectedProject]);

  // Create Fuse instance for fuzzy search
  const fuse = useMemo(() => {
    if (!slashCommands.length) return null;

    return new Fuse(slashCommands, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'description', weight: 1 }
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 1
    });
  }, [slashCommands]);

  // Filter commands based on query
  useEffect(() => {
    if (!commandQuery) {
      setFilteredCommands(slashCommands);
      return;
    }

    if (!fuse) {
      setFilteredCommands([]);
      return;
    }

    const results = fuse.search(commandQuery);
    setFilteredCommands(results.map(result => result.item));
  }, [commandQuery, slashCommands, fuse]);

  // Calculate frequently used commands
  const frequentCommands = useMemo(() => {
    if (!selectedProject || slashCommands.length === 0) return [];

    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);

    if (!history) return [];

    try {
      const parsedHistory = JSON.parse(history);

      // Sort commands by usage count
      const commandsWithUsage = slashCommands
        .map(cmd => ({
          ...cmd,
          usageCount: parsedHistory[cmd.name] || 0
        }))
        .filter(cmd => cmd.usageCount > 0)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 5); // Top 5 most used

      return commandsWithUsage;
    } catch (e) {
      console.error('Error parsing command history:', e);
      return [];
    }
  }, [selectedProject, slashCommands]);

  // Command selection callback with history tracking
  const handleCommandSelect = useCallback((command, index, isHover) => {
    if (!command || !selectedProject) return;

    // If hovering, just update the selected index
    if (isHover) {
      setSelectedCommandIndex(index);
      return;
    }

    // Update command history
    const historyKey = `command_history_${selectedProject.name}`;
    const history = safeLocalStorage.getItem(historyKey);
    let parsedHistory = {};

    try {
      parsedHistory = history ? JSON.parse(history) : {};
    } catch (e) {
      console.error('Error parsing command history:', e);
    }

    parsedHistory[command.name] = (parsedHistory[command.name] || 0) + 1;
    safeLocalStorage.setItem(historyKey, JSON.stringify(parsedHistory));

    // Execute the command
    executeCommand(command);
  }, [selectedProject]);

  // Execute a command
  const handleBuiltInCommand = useCallback((result) => {
    const { action, data } = result;

    switch (action) {
      case 'clear':
        // Clear conversation history
        setChatMessages([]);
        setSessionMessages([]);
        break;

      case 'help':
        // Show help content
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: data.content,
          timestamp: Date.now()
        }]);
        break;

      case 'model':
        // Show model information
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `**Current Model**: ${data.current.model}\n\n**Available Models**:\n\nClaude: ${data.available.claude.join(', ')}\n\nCursor: ${data.available.cursor.join(', ')}`,
          timestamp: Date.now()
        }]);
        break;

      case 'cost': {
        const costMessage = `**Token Usage**: ${data.tokenUsage.used.toLocaleString()} / ${data.tokenUsage.total.toLocaleString()} (${data.tokenUsage.percentage}%)\n\n**Estimated Cost**:\n- Input: $${data.cost.input}\n- Output: $${data.cost.output}\n- **Total**: $${data.cost.total}\n\n**Model**: ${data.model}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: costMessage, timestamp: Date.now() }]);
        break;
      }

      case 'status': {
        const statusMessage = `**System Status**\n\n- Version: ${data.version}\n- Uptime: ${data.uptime}\n- Model: ${data.model}\n- Provider: ${data.provider}\n- Node.js: ${data.nodeVersion}\n- Platform: ${data.platform}`;
        setChatMessages(prev => [...prev, { role: 'assistant', content: statusMessage, timestamp: Date.now() }]);
        break;
      }
      case 'memory':
        // Show memory file info
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `📝 ${data.message}\n\nPath: \`${data.path}\``,
            timestamp: Date.now()
          }]);
          // Optionally open file in editor
          if (data.exists && onFileOpen) {
            onFileOpen(data.path);
          }
        }
        break;

      case 'config':
        // Open settings
        if (onShowSettings) {
          onShowSettings();
        }
        break;

      case 'rewind':
        // Rewind conversation
        if (data.error) {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⚠️ ${data.message}`,
            timestamp: Date.now()
          }]);
        } else {
          // Remove last N messages
          setChatMessages(prev => prev.slice(0, -data.steps * 2)); // Remove user + assistant pairs
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `⏪ ${data.message}`,
            timestamp: Date.now()
          }]);
        }
        break;

      default:
        console.warn('Unknown built-in command action:', action);
    }
  }, [onFileOpen, onShowSettings]);

  // Ref to store handleSubmit so we can call it from handleCustomCommand
  const handleSubmitRef = useRef(null);

  // Handle custom command execution
  const handleCustomCommand = useCallback(async (result, args) => {
    const { content, hasBashCommands, hasFileIncludes } = result;

    // Show confirmation for bash commands
    if (hasBashCommands) {
      const confirmed = window.confirm(
        'This command contains bash commands that will be executed. Do you want to proceed?'
      );
      if (!confirmed) {
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: '❌ Command execution cancelled',
          timestamp: Date.now()
        }]);
        return;
      }
    }

    // Set the input to the command content
    setInput(content);

    // Wait for state to update, then directly call handleSubmit
    setTimeout(() => {
      if (handleSubmitRef.current) {
        // Create a fake event to pass to handleSubmit
        const fakeEvent = { preventDefault: () => {} };
        handleSubmitRef.current(fakeEvent);
      }
    }, 50);
  }, []);
  const executeCommand = useCallback(async (command) => {
    if (!command || !selectedProject) return;

    try {
      // Parse command and arguments from current input
      const commandMatch = input.match(new RegExp(`${command.name}\\s*(.*)`));
      const args = commandMatch && commandMatch[1]
        ? commandMatch[1].trim().split(/\s+/)
        : [];

      // Prepare context for command execution
      const context = {
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
        sessionId: currentSessionId,
        provider,
        model: provider === 'cursor' ? cursorModel : 'claude-sonnet-4.5',
        tokenUsage: tokenBudget
      };

      // Call the execute endpoint
      const response = await authenticatedFetch('/api/commands/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commandName: command.name,
          commandPath: command.path,
          args,
          context
        })
      });

      if (!response.ok) {
        throw new Error('Failed to execute command');
      }

      const result = await response.json();

      // Handle built-in commands
      if (result.type === 'builtin') {
        handleBuiltInCommand(result);
      } else if (result.type === 'custom') {
        // Handle custom commands - inject as system message
        await handleCustomCommand(result, args);
      }

      // Clear the input after successful execution
      setInput('');
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      setSelectedCommandIndex(-1);

    } catch (error) {
      console.error('Error executing command:', error);
      // Show error message to user
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error executing command: ${error.message}`,
        timestamp: Date.now()
      }]);
    }
  }, [input, selectedProject, currentSessionId, provider, cursorModel, tokenBudget]);

  // Handle built-in command actions


  // Memoized diff calculation to prevent recalculating on every render
  const createDiff = useMemo(() => {
    const cache = new Map();
    return (oldStr, newStr) => {
      const key = `${oldStr.length}-${newStr.length}-${oldStr.slice(0, 50)}`;
      if (cache.has(key)) {
        return cache.get(key);
      }
      
      const result = calculateDiff(oldStr, newStr);
      cache.set(key, result);
      if (cache.size > 100) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      return result;
    };
  }, []);

  // Load session messages from API with pagination
  const loadSessionMessages = useCallback(async (projectName, sessionId, loadMore = false) => {
    if (!projectName || !sessionId) return [];
    
    const isInitialLoad = !loadMore;
    if (isInitialLoad) {
      setIsLoadingSessionMessages(true);
    } else {
      // Only set state, ref is managed by handleScroll caller
      setIsLoadingMoreMessages(true);
    }
    
    try {
      const currentOffset = loadMore ? messagesOffset : 0;
      const response = await api.sessionMessages(projectName, sessionId, MESSAGES_PER_PAGE, currentOffset);
      if (!response.ok) {
        throw new Error('Failed to load session messages');
      }
      const data = await response.json();
      console.log('📩 loadSessionMessages response:', { messageCount: data.messages?.length, hasMore: data.hasMore, total: data.total });
      
      // Handle paginated response
      if (data.hasMore !== undefined) {
        setHasMoreMessages(data.hasMore);
        setTotalMessages(data.total);
        setMessagesOffset(currentOffset + (data.messages?.length || 0));
        return data.messages || [];
      } else {
        // Backward compatibility for non-paginated response
        const messages = data.messages || [];
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        return messages;
      }
    } catch (error) {
      console.error('Error loading session messages:', error);
      return [];
    } finally {
      if (isInitialLoad) {
        setIsLoadingSessionMessages(false);
      } else {
        // Reset both ref and state
        isLoadingMoreMessagesRef.current = false;
        setIsLoadingMoreMessages(false);
      }
    }
  }, [messagesOffset]);

  // Load Cursor session messages from SQLite via backend
  const loadCursorSessionMessages = useCallback(async (projectPath, sessionId) => {
    if (!projectPath || !sessionId) return [];
    setIsLoadingSessionMessages(true);
    try {
      const url = `/api/cursor/sessions/${encodeURIComponent(sessionId)}?projectPath=${encodeURIComponent(projectPath)}`;
      const res = await authenticatedFetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      const blobs = data?.session?.messages || [];
      const converted = [];
      const toolUseMap = {}; // Map to store tool uses by ID for linking results
      
      // First pass: process all messages maintaining order
      for (let blobIdx = 0; blobIdx < blobs.length; blobIdx++) {
        const blob = blobs[blobIdx];
        const content = blob.content;
        let text = '';
        let role = 'assistant';
        let reasoningText = null; // Move to outer scope
        try {
          // Handle different Cursor message formats
          if (content?.role && content?.content) {
            // Direct format: {"role":"user","content":[{"type":"text","text":"..."}]}
            // Skip system messages
            if (content.role === 'system') {
              continue;
            }
            
            // Handle tool messages
            if (content.role === 'tool') {
              // Tool result format - find the matching tool use message and update it
              if (Array.isArray(content.content)) {
                for (const item of content.content) {
                  if (item?.type === 'tool-result') {
                    // Map ApplyPatch to Edit for consistency
                    let toolName = item.toolName || 'Unknown Tool';
                    if (toolName === 'ApplyPatch') {
                      toolName = 'Edit';
                    }
                    const toolCallId = item.toolCallId || content.id;
                    const result = item.result || '';
                    
                    // Store the tool result to be linked later
                    if (toolUseMap[toolCallId]) {
                      toolUseMap[toolCallId].toolResult = {
                        content: result,
                        isError: false
                      };
                    } else {
                      // No matching tool use found, create a standalone result message
                      converted.push({
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid,
                        isToolUse: true,
                        toolName: toolName,
                        toolId: toolCallId,
                        toolInput: null,
                        toolResult: {
                          content: result,
                          isError: false
                        }
                      });
                    }
                  }
                }
              }
              continue; // Don't add tool messages as regular messages
            } else {
              // User or assistant messages
              role = content.role === 'user' ? 'user' : 'assistant';
              
              if (Array.isArray(content.content)) {
                // Extract text, reasoning, and tool calls from content array
                const textParts = [];
                
                for (const part of content.content) {
                  if (part?.type === 'text' && part?.text) {
                    textParts.push(decodeHtmlEntities(part.text));
                  } else if (part?.type === 'reasoning' && part?.text) {
                    // Handle reasoning type - will be displayed in a collapsible section
                    reasoningText = decodeHtmlEntities(part.text);
                  } else if (part?.type === 'tool-call') {
                    // First, add any text/reasoning we've collected so far as a message
                    if (textParts.length > 0 || reasoningText) {
                      converted.push({
                        type: role,
                        content: textParts.join('\n'),
                        reasoning: reasoningText,
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid
                      });
                      textParts.length = 0;
                      reasoningText = null;
                    }
                    
                    // Tool call in assistant message - format like Claude Code
                    // Map ApplyPatch to Edit for consistency with Claude Code
                    let toolName = part.toolName || 'Unknown Tool';
                    if (toolName === 'ApplyPatch') {
                      toolName = 'Edit';
                    }
                    const toolId = part.toolCallId || `tool_${blobIdx}`;
                    
                    // Create a tool use message with Claude Code format
                    // Map Cursor args format to Claude Code format
                    let toolInput = part.args;
                    
                    if (toolName === 'Edit' && part.args) {
                      // ApplyPatch uses 'patch' format, convert to Edit format
                      if (part.args.patch) {
                        // Parse the patch to extract old and new content
                        const patchLines = part.args.patch.split('\n');
                        let oldLines = [];
                        let newLines = [];
                        let inPatch = false;
                        
                        for (const line of patchLines) {
                          if (line.startsWith('@@')) {
                            inPatch = true;
                          } else if (inPatch) {
                            if (line.startsWith('-')) {
                              oldLines.push(line.substring(1));
                            } else if (line.startsWith('+')) {
                              newLines.push(line.substring(1));
                            } else if (line.startsWith(' ')) {
                              // Context line - add to both
                              oldLines.push(line.substring(1));
                              newLines.push(line.substring(1));
                            }
                          }
                        }
                        
                        const filePath = part.args.file_path;
                        const absolutePath = filePath && !filePath.startsWith('/') 
                          ? `${projectPath}/${filePath}` 
                          : filePath;
                        toolInput = {
                          file_path: absolutePath,
                          old_string: oldLines.join('\n') || part.args.patch,
                          new_string: newLines.join('\n') || part.args.patch
                        };
                      } else {
                        // Direct edit format
                        toolInput = part.args;
                      }
                    } else if (toolName === 'Read' && part.args) {
                      // Map 'path' to 'file_path'
                      // Convert relative path to absolute if needed
                      const filePath = part.args.path || part.args.file_path;
                      const absolutePath = filePath && !filePath.startsWith('/') 
                        ? `${projectPath}/${filePath}` 
                        : filePath;
                      toolInput = {
                        file_path: absolutePath
                      };
                    } else if (toolName === 'Write' && part.args) {
                      // Map fields for Write tool
                      const filePath = part.args.path || part.args.file_path;
                      const absolutePath = filePath && !filePath.startsWith('/') 
                        ? `${projectPath}/${filePath}` 
                        : filePath;
                      toolInput = {
                        file_path: absolutePath,
                        content: part.args.contents || part.args.content
                      };
                    }
                    
                    const toolMessage = {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid,
                      isToolUse: true,
                      toolName: toolName,
                      toolId: toolId,
                      toolInput: toolInput ? JSON.stringify(toolInput) : null,
                      toolResult: null // Will be filled when we get the tool result
                    };
                    converted.push(toolMessage);
                    toolUseMap[toolId] = toolMessage; // Store for linking results
                  } else if (part?.type === 'tool_use') {
                    // Old format support
                    if (textParts.length > 0 || reasoningText) {
                      converted.push({
                        type: role,
                        content: textParts.join('\n'),
                        reasoning: reasoningText,
                        timestamp: new Date(Date.now() + blobIdx * 1000),
                        blobId: blob.id,
                        sequence: blob.sequence,
                        rowid: blob.rowid
                      });
                      textParts.length = 0;
                      reasoningText = null;
                    }
                    
                    const toolName = part.name || 'Unknown Tool';
                    const toolId = part.id || `tool_${blobIdx}`;
                    
                    const toolMessage = {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid,
                      isToolUse: true,
                      toolName: toolName,
                      toolId: toolId,
                      toolInput: part.input ? JSON.stringify(part.input) : null,
                      toolResult: null
                    };
                    converted.push(toolMessage);
                    toolUseMap[toolId] = toolMessage;
                  } else if (typeof part === 'string') {
                    textParts.push(part);
                  }
                }
                
                // Add any remaining text/reasoning
                if (textParts.length > 0) {
                  text = textParts.join('\n');
                  if (reasoningText && !text) {
                    // Just reasoning, no text
                    converted.push({
                      type: role,
                      content: '',
                      reasoning: reasoningText,
                      timestamp: new Date(Date.now() + blobIdx * 1000),
                      blobId: blob.id,
                      sequence: blob.sequence,
                      rowid: blob.rowid
                    });
                    text = ''; // Clear to avoid duplicate
                  }
                } else {
                  text = '';
                }
              } else if (typeof content.content === 'string') {
                text = content.content;
              }
            }
          } else if (content?.message?.role && content?.message?.content) {
            // Nested message format
            if (content.message.role === 'system') {
              continue;
            }
            role = content.message.role === 'user' ? 'user' : 'assistant';
            if (Array.isArray(content.message.content)) {
              text = content.message.content
                .map(p => (typeof p === 'string' ? p : (p?.text || '')))
                .filter(Boolean)
                .join('\n');
            } else if (typeof content.message.content === 'string') {
              text = content.message.content;
            }
          }
        } catch (e) {
          console.log('Error parsing blob content:', e);
        }
        if (text && text.trim()) {
          const message = {
            type: role,
            content: text,
            timestamp: new Date(Date.now() + blobIdx * 1000),
            blobId: blob.id,
            sequence: blob.sequence,
            rowid: blob.rowid
          };
          
          // Add reasoning if we have it
          if (reasoningText) {
            message.reasoning = reasoningText;
          }
          
          converted.push(message);
        }
      }
      
      // Sort messages by sequence/rowid to maintain chronological order
      converted.sort((a, b) => {
        // First sort by sequence if available (clean 1,2,3... numbering)
        if (a.sequence !== undefined && b.sequence !== undefined) {
          return a.sequence - b.sequence;
        }
        // Then try rowid (original SQLite row IDs)
        if (a.rowid !== undefined && b.rowid !== undefined) {
          return a.rowid - b.rowid;
        }
        // Fallback to timestamp
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      return converted;
    } catch (e) {
      console.error('Error loading Cursor session messages:', e);
      return [];
    } finally {
      setIsLoadingSessionMessages(false);
    }
  }, []);

  // Actual diff calculation function
  const calculateDiff = (oldStr, newStr) => {
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');
    
    // Simple diff algorithm - find common lines and differences
    const diffLines = [];
    let oldIndex = 0;
    let newIndex = 0;
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      const oldLine = oldLines[oldIndex];
      const newLine = newLines[newIndex];
      
      if (oldIndex >= oldLines.length) {
        // Only new lines remaining
        diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
        newIndex++;
      } else if (newIndex >= newLines.length) {
        // Only old lines remaining
        diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
        oldIndex++;
      } else if (oldLine === newLine) {
        // Lines are the same - skip in diff view (or show as context)
        oldIndex++;
        newIndex++;
      } else {
        // Lines are different
        diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
        diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
        oldIndex++;
        newIndex++;
      }
    }
    
    return diffLines;
  };

  const convertSessionMessages = (rawMessages) => {
    const converted = [];
    const toolResults = new Map(); // Map tool_use_id or callId to tool result
    
    // First pass: collect all tool results
    for (const msg of rawMessages) {
      // Support both Claude format (nested message) and CodeBuddy format (flat)
      const role = msg.message?.role || msg.role;
      const content = msg.message?.content || msg.content;
      
      if (role === 'user' && Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'tool_result') {
            toolResults.set(part.tool_use_id, {
              content: part.content,
              isError: part.is_error,
              timestamp: new Date(msg.timestamp || Date.now()),
              // Extract structured tool result data (e.g., for Grep, Glob)
              toolUseResult: msg.toolUseResult || null
            });
          }
        }
      }
      
      // Handle function_call_result type (CodeBuddy format)
      if (msg.type === 'function_call_result') {
        const resultContent = msg.output?.text || msg.output || '';
        toolResults.set(msg.callId, {
          content: resultContent,
          isError: msg.status === 'error',
          timestamp: new Date(msg.timestamp || Date.now()),
          toolUseResult: msg.providerData?.toolResult || null
        });
      }
    }
    
    // Second pass: process messages and attach tool results to tool uses
    for (const msg of rawMessages) {
      // Support both Claude format (nested message) and CodeBuddy format (flat)
      const role = msg.message?.role || msg.role;
      const content = msg.message?.content || msg.content;
      
      // Handle function_call type (CodeBuddy format)
      if (msg.type === 'function_call') {
        const toolResult = toolResults.get(msg.callId);
        const displayText = msg.providerData?.argumentsDisplayText || '';
        
        converted.push({
          type: 'assistant',
          content: '',
          timestamp: msg.timestamp || new Date().toISOString(),
          isToolUse: true,
          toolName: msg.name || 'Unknown Tool',
          toolId: msg.callId,
          toolInput: msg.arguments || '{}',
          toolResult: toolResult ? {
            content: (() => {
              // Keep array if it contains image data, otherwise convert to string
              if (hasImageContent(toolResult.content)) {
                return toolResult.content;
              }
              return typeof toolResult.content === 'string' 
                ? toolResult.content 
                : JSON.stringify(toolResult.content);
            })(),
            isError: toolResult.isError,
            toolUseResult: toolResult.toolUseResult
          } : null,
          toolError: toolResult?.isError || false,
          toolResultTimestamp: toolResult?.timestamp || new Date(),
          displayText: displayText
        });
        continue;
      }
      
      // Skip function_call_result messages as they are handled in first pass
      if (msg.type === 'function_call_result') {
        continue;
      }
      
      // Handle user messages
      if (role === 'user' && content) {
        let textContent = '';
        let messageType = 'user';
        
        if (Array.isArray(content)) {
          // Handle array content, but skip tool results (they're attached to tool uses)
          const textParts = [];
          
          for (const part of content) {
            if (part.type === 'text' || part.type === 'input_text') {
              // Support both 'text' and 'input_text' types
              textParts.push(decodeHtmlEntities(part.text));
            }
            // Skip tool_result parts - they're handled in the first pass
          }
          
          textContent = textParts.join('\n');
        } else if (typeof content === 'string') {
          textContent = decodeHtmlEntities(content);
        } else {
          textContent = decodeHtmlEntities(String(content));
        }
        
        // Skip command messages, system messages, and empty content
        const shouldSkip = !textContent ||
                          textContent.startsWith('<command-name>') ||
                          textContent.startsWith('<command-message>') ||
                          textContent.startsWith('<command-args>') ||
                          textContent.startsWith('<local-command-stdout>') ||
                          textContent.startsWith('<system-reminder>') ||
                          textContent.startsWith('Caveat:') ||
                          textContent.startsWith('This session is being continued from a previous') ||
                          textContent.startsWith('[Request interrupted');

        if (!shouldSkip) {
          // Unescape with math formula protection
          textContent = unescapeWithMathProtection(textContent);
          converted.push({
            type: messageType,
            content: textContent,
            timestamp: msg.timestamp || new Date().toISOString()
          });
        }
      }
      
      // Handle assistant messages
      else if (role === 'assistant' && content) {
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === 'text' || part.type === 'output_text') {
              // Support both 'text' and 'output_text' types
              // Unescape with math formula protection
              let text = part.text;
              if (typeof text === 'string') {
                text = unescapeWithMathProtection(text);
              }
              converted.push({
                type: 'assistant',
                content: text,
                timestamp: msg.timestamp || new Date().toISOString()
              });
            } else if (part.type === 'tool_use') {
              // Get the corresponding tool result
              const toolResult = toolResults.get(part.id);

              converted.push({
                type: 'assistant',
                content: '',
                timestamp: msg.timestamp || new Date().toISOString(),
                isToolUse: true,
                toolName: part.name,
                toolId: part.id,
                toolInput: JSON.stringify(part.input),
                toolResult: toolResult ? {
                  content: (() => {
                    // Keep array if it contains image data, otherwise convert to string
                    if (hasImageContent(toolResult.content)) {
                      return toolResult.content;
                    }
                    return typeof toolResult.content === 'string' 
                      ? toolResult.content 
                      : JSON.stringify(toolResult.content);
                  })(),
                  isError: toolResult.isError,
                  toolUseResult: toolResult.toolUseResult
                } : null,
                toolError: toolResult?.isError || false,
                toolResultTimestamp: toolResult?.timestamp || new Date()
              });
            }
          }
        } else if (typeof content === 'string') {
          // Unescape with math formula protection
          let text = content;
          text = unescapeWithMathProtection(text);
          converted.push({
            type: 'assistant',
            content: text,
            timestamp: msg.timestamp || new Date().toISOString()
          });
        }
      }
    }
    
    return converted;
  };

  // Memoize expensive convertSessionMessages operation
  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  // Note: Token budgets are not saved to JSONL files, only sent via WebSocket
  // So we don't try to extract them from loaded sessionMessages

  // Define scroll functions early to avoid hoisting issues in useEffect dependencies
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      // Don't reset isUserScrolledUp here - let the scroll handler manage it
      // This prevents fighting with user's scroll position during streaming
    }
  }, []);

  // Check if user is near the bottom of the scroll container
  const isNearBottom = useCallback(() => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Consider "near bottom" if within 50px of the bottom
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  // Throttle ref to prevent rapid scroll loading (minimum 2 seconds between loads)
  const lastScrollLoadTimeRef = useRef(0);
  // Track pull-down gesture for loading more messages
  const touchStartYRef = useRef(0);
  const pullDownTriggeredRef = useRef(false);

  // Load more messages when pull-down is triggered
  const loadMoreMessagesOnPullDown = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const provider = localStorage.getItem('selected-provider') || 'claude';
    
    // Throttle: minimum 2 seconds between load requests
    const now = Date.now();
    if (now - lastScrollLoadTimeRef.current < 2000) {
      return;
    }
    
    // Use ref for immediate check to prevent duplicate triggers (state is async)
    if (hasMoreMessages && !isLoadingMoreMessagesRef.current && selectedSession && selectedProject && provider !== 'cursor') {
      // IMMEDIATELY set ref and timestamp to block any concurrent scroll events
      isLoadingMoreMessagesRef.current = true;
      lastScrollLoadTimeRef.current = now;
      
      // Save distance from bottom (this stays constant after prepending content)
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      
      try {
        // Load more messages
        const moreMessages = await loadSessionMessages(selectedProject.name, selectedSession.id, true);
        
        if (moreMessages.length > 0) {
          // Save scroll restore info to ref - will be used by useEffect after chatMessages updates
          pendingScrollRestoreRef.current = {
            distanceFromBottom
          };
          
          // Prepend new messages to the existing ones
          setSessionMessages(prev => [...moreMessages, ...prev]);
        }
      } catch (error) {
        console.error('Error loading more messages:', error);
        // Reset ref on error so user can retry
        isLoadingMoreMessagesRef.current = false;
      }
    }
  }, [hasMoreMessages, selectedSession, selectedProject, loadSessionMessages]);

  // Handle scroll events to detect when user manually scrolls up and load more messages
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const nearBottom = isNearBottom();
      setIsUserScrolledUp(!nearBottom);
    }
  }, [isNearBottom]);

  // Handle touch start - record initial Y position
  const handleTouchStart = useCallback((e) => {
    touchStartYRef.current = e.touches[0].clientY;
    pullDownTriggeredRef.current = false;
  }, []);

  // Handle touch move - detect pull-down gesture at top
  const handleTouchMove = useCallback((e) => {
    if (!scrollContainerRef.current || pullDownTriggeredRef.current) return;
    
    const container = scrollContainerRef.current;
    const atTop = container.scrollTop === 0;
    const touchY = e.touches[0].clientY;
    const pullDistance = touchY - touchStartYRef.current;
    
    // Trigger load when: at top + pulling down more than 50px
    if (atTop && pullDistance > 50) {
      pullDownTriggeredRef.current = true;
      loadMoreMessagesOnPullDown();
    }
  }, [loadMoreMessagesOnPullDown]);

  // Handle wheel event for desktop - detect scroll up at top
  const handleWheel = useCallback((e) => {
    if (!scrollContainerRef.current) return;
    
    const container = scrollContainerRef.current;
    const atTop = container.scrollTop === 0;
    
    // Trigger load when: at top + scrolling up (negative deltaY)
    if (atTop && e.deltaY < -30) {
      loadMoreMessagesOnPullDown();
    }
  }, [loadMoreMessagesOnPullDown]);

  useEffect(() => {
    // Load session messages when session changes
    const loadMessages = async () => {
      if (selectedSession && selectedProject) {
        const provider = localStorage.getItem('selected-provider') || 'claude';

        // Mark that we're loading a session to prevent multiple scroll triggers
        isLoadingSessionRef.current = true;

        // Only reset state if the session ID actually changed (not initial load)
        const sessionChanged = currentSessionId !== null && currentSessionId !== selectedSession.id;

        if (sessionChanged) {
          // Reset pagination state when switching sessions
          setMessagesOffset(0);
          setHasMoreMessages(false);
          setTotalMessages(0);
          // Reset token budget when switching sessions
          // It will update when user sends a message and receives new budget from WebSocket
          setTokenBudget(null);
          // Reset loading state when switching sessions (unless the new session is processing)
          // The restore effect will set it back to true if needed
          setIsLoading(false);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider
            });
          }
        } else if (currentSessionId === null) {
          // Initial load - reset pagination but not token budget
          setMessagesOffset(0);
          setHasMoreMessages(false);
          setTotalMessages(0);

          // Check if the session is currently processing on the backend
          if (ws && sendMessage) {
            sendMessage({
              type: 'check-session-status',
              sessionId: selectedSession.id,
              provider
            });
          }
        }
        
        if (provider === 'cursor') {
          // For Cursor, set the session ID for resuming
          setCurrentSessionId(selectedSession.id);
          sessionStorage.setItem('cursorSessionId', selectedSession.id);
          
          // Only load messages from SQLite if this is NOT a system-initiated session change
          // For system-initiated changes, preserve existing messages
          if (!isSystemSessionChange) {
            // Load historical messages for Cursor session from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        } else {
          // For Claude, load messages normally with pagination
          setCurrentSessionId(selectedSession.id);
          
          // Only load messages from API if this is a user-initiated session change
          // For system-initiated changes, preserve existing messages and rely on WebSocket
          if (!isSystemSessionChange) {
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo
            // Scroll will be handled by the main scroll useEffect after messages are rendered
          } else {
            // Reset the flag after handling system session change
            setIsSystemSessionChange(false);
          }
        }
      } else {
        // Only clear messages if this is NOT a system-initiated session change AND we're not loading
        // During system session changes or while loading, preserve the chat messages
        if (!isSystemSessionChange && !isLoading) {
          setChatMessages([]);
          setSessionMessages([]);
        }
        setCurrentSessionId(null);
        sessionStorage.removeItem('cursorSessionId');
        setMessagesOffset(0);
        setHasMoreMessages(false);
        setTotalMessages(0);
      }

      // Mark loading as complete after messages are set
      // Use setTimeout to ensure state updates and DOM rendering are complete
      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [selectedSession, selectedProject, loadCursorSessionMessages, scrollToBottom, isSystemSessionChange]);

  // External Message Update Handler: Reload messages when external CLI modifies current session
  // This triggers when App.jsx detects a JSONL file change for the currently-viewed session
  // Only reloads if the session is NOT active (respecting Session Protection System)
  useEffect(() => {
    if (externalMessageUpdate > 0 && selectedSession && selectedProject) {
      const reloadExternalMessages = async () => {
        try {
          const provider = localStorage.getItem('selected-provider') || 'claude';

          if (provider === 'cursor') {
            // Reload Cursor messages from SQLite
            const projectPath = selectedProject.fullPath || selectedProject.path;
            const converted = await loadCursorSessionMessages(projectPath, selectedSession.id);
            setSessionMessages([]);
            setChatMessages(converted);
          } else {
            // Reload Claude messages from API/JSONL
            const messages = await loadSessionMessages(selectedProject.name, selectedSession.id, false);
            setSessionMessages(messages);
            // convertedMessages will be automatically updated via useMemo

            // Smart scroll behavior: only auto-scroll if user is near bottom
            if (isNearBottom && autoScrollToBottom) {
              setTimeout(() => scrollToBottom(), 200);
            }
            // If user scrolled up, preserve their position (they're reading history)
          }
        } catch (error) {
          console.error('Error reloading messages from external update:', error);
        }
      };

      reloadExternalMessages();
    }
  }, [externalMessageUpdate, selectedSession, selectedProject, loadCursorSessionMessages, loadSessionMessages, isNearBottom, autoScrollToBottom, scrollToBottom]);

  // Update chatMessages when convertedMessages changes
  useEffect(() => {
    if (sessionMessages.length > 0) {
      setChatMessages(convertedMessages);
      
      // Restore scroll position after loading more messages (maintain distance from bottom)
      if (pendingScrollRestoreRef.current && scrollContainerRef.current) {
        const { distanceFromBottom } = pendingScrollRestoreRef.current;
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight;
            const clientHeight = scrollContainerRef.current.clientHeight;
            // Restore: scrollTop = scrollHeight - clientHeight - distanceFromBottom
            scrollContainerRef.current.scrollTop = newScrollHeight - clientHeight - distanceFromBottom;
          }
          pendingScrollRestoreRef.current = null;
        });
      }
    } else if (sessionMessages.length === 0 && convertedMessages.length === 0) {
      // Clear chatMessages when switching to an empty session
      // Only clear if we're not in a loading or system session change state
      if (!isLoadingSessionMessages && !isSystemSessionChange) {
        setChatMessages([]);
      }
    }
  }, [convertedMessages, sessionMessages, isLoadingSessionMessages, isSystemSessionChange]);

  // Notify parent when input focus changes
  useEffect(() => {
    if (onInputFocusChange) {
      onInputFocusChange(isInputFocused);
    }
  }, [isInputFocused, onInputFocusChange]);

  // Persist input draft to localStorage
  useEffect(() => {
    if (selectedProject && input !== '') {
      safeLocalStorage.setItem(`draft_input_${selectedProject.name}`, input);
    } else if (selectedProject && input === '') {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, selectedProject]);

  // Persist chat messages to localStorage
  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(chatMessages));
    }
  }, [chatMessages, selectedProject]);

  // Load saved state when project changes (but don't interfere with session loading)
  useEffect(() => {
    if (selectedProject) {
      // Always load saved input draft for the project
      const savedInput = safeLocalStorage.getItem(`draft_input_${selectedProject.name}`) || '';
      if (savedInput !== input) {
        setInput(savedInput);
      }
    }
  }, [selectedProject?.name]);

  // Track processing state: notify parent when isLoading becomes true
  // Note: onSessionNotProcessing is called directly in completion message handlers
  useEffect(() => {
    if (currentSessionId && isLoading && onSessionProcessing) {
      onSessionProcessing(currentSessionId);
    }
  }, [isLoading, currentSessionId, onSessionProcessing]);

  // Restore processing state when switching to a processing session
  useEffect(() => {
    if (currentSessionId && processingSessions) {
      const shouldBeProcessing = processingSessions.has(currentSessionId);
      if (shouldBeProcessing && !isLoading) {
        setIsLoading(true);
        setCanAbortSession(true); // Assume processing sessions can be aborted
      }
    }
  }, [currentSessionId, processingSessions]);

  useEffect(() => {
    // Handle WebSocket messages
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];

      // Filter messages by session ID to prevent cross-session interference
      // Skip filtering for global messages that apply to all sessions
      const globalMessageTypes = ['projects_updated', 'session-created', 'claude-complete'];
      const isGlobalMessage = globalMessageTypes.includes(latestMessage.type);

      // For new sessions (currentSessionId is null), allow messages through
      if (!isGlobalMessage && latestMessage.sessionId && currentSessionId && latestMessage.sessionId !== currentSessionId) {
        // Message is for a different session, ignore it
        console.log('⏭️ Skipping message for different session:', latestMessage.sessionId, 'current:', currentSessionId);
        return;
      }

      switch (latestMessage.type) {
        case 'session-created':
          // New session created by Claude CLI - we receive the real session ID here
          // Store it temporarily until conversation completes (prevents premature session association)
          if (latestMessage.sessionId && !currentSessionId) {
            sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
            
            // Session Protection: Replace temporary "new-session-*" identifier with real session ID
            // This maintains protection continuity - no gap between temp ID and real ID
            // The temporary session is removed and real session is marked as active
            if (onReplaceTemporarySession) {
              onReplaceTemporarySession(latestMessage.sessionId);
            }
          }
          break;

        case 'session-resume-failed':
          // Issue 3 fix: Handle session resume failure notification from backend
          console.warn('⚠️ Session resume failed:', {
            requested: latestMessage.requestedSessionId,
            created: latestMessage.newSessionId,
            message: latestMessage.message
          });
          
          // Show a warning message to the user
          setChatMessages(prev => [...prev, {
            type: 'system',
            content: `注意: 无法恢复之前的会话，已创建新会话。${latestMessage.message || ''}`,
            isWarning: true,
            timestamp: new Date()
          }]);
          
          // Update the pending session ID to the new one
          if (latestMessage.newSessionId) {
            sessionStorage.setItem('pendingSessionId', latestMessage.newSessionId);
            if (onReplaceTemporarySession) {
              onReplaceTemporarySession(latestMessage.newSessionId);
            }
          }
          break;

        case 'token-budget':
          // Token budget now fetched via API after message completion instead of WebSocket
          // This case is kept for compatibility but does nothing
          break;

        case 'claude-response':
          const messageData = latestMessage.data.message || latestMessage.data;
          
          // Debug log for CodeBuddy messages
          console.log('📨 claude-response received:', messageData?.type, messageData);
          
          // Handle Cursor streaming format (content_block_start / content_block_delta / content_block_stop)
          if (messageData && typeof messageData === 'object' && messageData.type) {
            // Handle content_block_start for tool_use (from CodeBuddy)
            if (messageData.type === 'content_block_start' && messageData.content_block) {
              const contentBlock = messageData.content_block;
              if (contentBlock.type === 'tool_use') {
                const toolId = contentBlock.id;
                // Check if we have a pending result for this tool
                const pendingResult = pendingToolResultsRef.current.get(toolId);
                
                // Add tool use message (with pending result if available)
                const toolInput = contentBlock.input ? JSON.stringify(contentBlock.input, null, 2) : '';
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: contentBlock.name,
                  toolInput: toolInput,
                  toolId: toolId,
                  toolResult: pendingResult || null
                }]);
                
                // Remove from pending queue if we used it
                if (pendingResult) {
                  console.log('✅ Applied pending result for:', toolId);
                  pendingToolResultsRef.current.delete(toolId);
                }
              }
              return;
            }
            
            // Handle tool_result (from CodeBuddy)
            if (messageData.type === 'tool_result') {
              // Keep content array if it contains images, otherwise convert to string
              let resultContent = messageData.content;
              
              if (Array.isArray(resultContent) && !hasImageContent(resultContent)) {
                // Extract text from content array (common format: [{type: 'text', text: '...'}])
                resultContent = resultContent
                  .map(item => item.text || (typeof item === 'string' ? item : JSON.stringify(item)))
                  .join('\n');
              } else if (typeof resultContent === 'object' && resultContent !== null && !hasImageContent(resultContent)) {
                resultContent = JSON.stringify(resultContent, null, 2);
              }
              // If hasImageContent, keep resultContent as-is (the array with image objects)
              
              const toolUseId = messageData.tool_use_id;
              // Issue 8 fix: Use consistent toolUseResult structure for tool results
              const toolResultData = {
                toolUseResult: {
                  content: resultContent,
                  isError: messageData.is_error
                },
                timestamp: new Date()
              };
              
              console.log('📥 Received tool_result:', toolUseId, 'content:', String(resultContent).slice(0, 100));
              
              // Store in pending queue first
              pendingToolResultsRef.current.set(toolUseId, toolResultData);
              
              // Try to apply the result immediately
              setChatMessages(prev => {
                const toolUseIndex = prev.findIndex(msg => msg.isToolUse && msg.toolId === toolUseId);
                if (toolUseIndex !== -1) {
                  console.log('✅ Matched tool_use:', prev[toolUseIndex].toolName, toolUseId);
                  // Remove from pending queue since we found a match
                  pendingToolResultsRef.current.delete(toolUseId);
                  const updated = [...prev];
                  updated[toolUseIndex] = {
                    ...updated[toolUseIndex],
                    toolResult: toolResultData
                  };
                  return updated;
                }
                // If not found, keep in pending queue and return unchanged
                console.log('⏳ Tool use not found yet, queued:', toolUseId);
                return prev;
              });
              return;
            }
            
            if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
              // Decode HTML entities and buffer deltas
              const decodedText = decodeHtmlEntities(messageData.delta.text);
              streamBufferRef.current += decodedText;
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = (last.content || '') + chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
              return;
            }
            if (messageData.type === 'content_block_stop') {
              // Flush any buffered text and mark streaming message complete
              // NOTE: Don't clear loading state here - CodeBuddy sends multiple content_block_stop
              // (one per tool call). Loading state is cleared in codebuddy-result/codebuddy-complete.
              if (streamTimerRef.current) {
                clearTimeout(streamTimerRef.current);
                streamTimerRef.current = null;
              }
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              if (chunk) {
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = (last.content || '') + chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && last.isStreaming) {
                  last.isStreaming = false;
                }
                return updated;
              });
              return;
            }
            if (messageData.type === 'message_stop') {
              // message_stop indicates the entire message is complete
              // Flush any buffered text
              if (streamTimerRef.current) {
                clearTimeout(streamTimerRef.current);
                streamTimerRef.current = null;
              }
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              if (chunk) {
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = (last.content || '') + chunk;
                  } else {
                    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                  }
                  return updated;
                });
              }
              setChatMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && last.isStreaming) {
                  last.isStreaming = false;
                }
                return updated;
              });
              
              // Clear loading state only on message_stop (not content_block_stop)
              setIsLoading(false);
              setCanAbortSession(false);
              
              return;
            }
          }

          // Handle Claude CLI session duplication bug workaround:
          // When resuming a session, Claude CLI creates a new session instead of resuming.
          // We detect this by checking for system/init messages with session_id that differs
          // from our current session. When found, we need to switch the user to the new session.
          // This works exactly like new session detection - preserve messages during navigation.
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              currentSessionId && 
              latestMessage.data.session_id !== currentSessionId) {
            
            console.log('🔄 Claude CLI session duplication detected:', {
              originalSession: currentSessionId,
              newSession: latestMessage.data.session_id
            });
            
            // Mark this as a system-initiated session change to preserve messages
            // This works exactly like new session init - messages stay visible during navigation
            setIsSystemSessionChange(true);
            
            // Switch to the new session using React Router navigation
            // This triggers the session loading logic in App.jsx without a page reload
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }
          
          // Handle system/init for new sessions (when currentSessionId is null)
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              !currentSessionId) {
            
            console.log('🔄 New session init detected:', {
              newSession: latestMessage.data.session_id
            });
            
            // Mark this as a system-initiated session change to preserve messages
            setIsSystemSessionChange(true);
            
            // Switch to the new session
            if (onNavigateToSession) {
              onNavigateToSession(latestMessage.data.session_id);
            }
            return; // Don't process the message further, let the navigation handle it
          }
          
          // For system/init messages that match current session, just ignore them
          if (latestMessage.data.type === 'system' && 
              latestMessage.data.subtype === 'init' && 
              latestMessage.data.session_id && 
              currentSessionId && 
              latestMessage.data.session_id === currentSessionId) {
            console.log('🔄 System init message for current session, ignoring');
            return; // Don't process the message further
          }
          
          // Handle different types of content in the response
          if (Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_use') {
                // Add tool use message
                const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput: toolInput,
                  toolId: part.id,
                  toolResult: null // Will be updated when result comes in
                }]);
              } else if (part.type === 'text' && part.text?.trim()) {
                // Decode HTML entities and normalize usage limit message to local time
                let content = decodeHtmlEntities(part.text);
                content = formatUsageLimitText(content);

                // Add regular text message
                setChatMessages(prev => [...prev, {
                  type: 'assistant',
                  content: content,
                  timestamp: new Date()
                }]);
              }
            }
          } else if (typeof messageData.content === 'string' && messageData.content.trim()) {
            // Decode HTML entities and normalize usage limit message to local time
            let content = decodeHtmlEntities(messageData.content);
            content = formatUsageLimitText(content);

            // Add regular text message
            setChatMessages(prev => [...prev, {
              type: 'assistant',
              content: content,
              timestamp: new Date()
            }]);
          }
          
          // Handle tool results from user messages (these come separately)
          if (messageData.role === 'user' && Array.isArray(messageData.content)) {
            for (const part of messageData.content) {
              if (part.type === 'tool_result') {
                // Find the corresponding tool use and update it with the result
                setChatMessages(prev => prev.map(msg => {
                  if (msg.isToolUse && msg.toolId === part.tool_use_id) {
                    return {
                      ...msg,
                      toolResult: {
                        content: part.content,
                        isError: part.is_error,
                        timestamp: new Date()
                      }
                    };
                  }
                  return msg;
                }));
              }
            }
          }
          break;
          
        case 'claude-output':
          {
            const cleaned = String(latestMessage.data || '');
            if (cleaned.trim()) {
              streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
            }
          }
          break;
        case 'claude-interactive-prompt':
          // Handle interactive prompts from CLI
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: latestMessage.data,
            timestamp: new Date(),
            isInteractivePrompt: true
          }]);
          break;

        case 'claude-error':
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date()
          }]);
          break;
          
        case 'cursor-system':
          // Handle Cursor system/init messages similar to Claude
          try {
            const cdata = latestMessage.data;
            if (cdata && cdata.type === 'system' && cdata.subtype === 'init' && cdata.session_id) {
              // If we already have a session and this differs, switch (duplication/redirect)
              if (currentSessionId && cdata.session_id !== currentSessionId) {
                console.log('🔄 Cursor session switch detected:', { originalSession: currentSessionId, newSession: cdata.session_id });
                setIsSystemSessionChange(true);
                if (onNavigateToSession) {
                  onNavigateToSession(cdata.session_id);
                }
                return;
              }
              // If we don't yet have a session, adopt this one
              if (!currentSessionId) {
                console.log('🔄 Cursor new session init detected:', { newSession: cdata.session_id });
                setIsSystemSessionChange(true);
                if (onNavigateToSession) {
                  onNavigateToSession(cdata.session_id);
                }
                return;
              }
            }
            // For other cursor-system messages, avoid dumping raw objects to chat
          } catch (e) {
            console.warn('Error handling cursor-system message:', e);
          }
          break;
          
        case 'cursor-user':
          // Handle Cursor user messages (usually echoes)
          // Don't add user messages as they're already shown from input
          break;
          
        case 'cursor-tool-use':
          // Handle Cursor tool use messages
          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: `Using tool: ${latestMessage.tool} ${latestMessage.input ? `with ${latestMessage.input}` : ''}`,
            timestamp: new Date(),
            isToolUse: true,
            toolName: latestMessage.tool,
            toolInput: latestMessage.input
          }]);
          break;
        
        case 'cursor-error':
          // Show Cursor errors as error messages in chat
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `Cursor error: ${latestMessage.error || 'Unknown error'}`,
            timestamp: new Date()
          }]);
          break;
          
        case 'cursor-result':
          // Get session ID from message or fall back to current session
          const cursorCompletedSessionId = latestMessage.sessionId || currentSessionId;

          // Only update UI state if this is the current session
          if (cursorCompletedSessionId === currentSessionId) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }

          // Always mark the completed session as inactive and not processing
          if (cursorCompletedSessionId) {
            // Mark as recently completed to prevent file watcher race conditions
            if (onSessionCompleted) {
              onSessionCompleted(cursorCompletedSessionId, 'cursor');
            }
            if (onSessionInactive) {
              onSessionInactive(cursorCompletedSessionId);
            }
            if (onSessionNotProcessing) {
              onSessionNotProcessing(cursorCompletedSessionId);
            }
          }

          // Only process result for current session
          if (cursorCompletedSessionId === currentSessionId) {
            try {
              const r = latestMessage.data || {};
              const textResult = typeof r.result === 'string' ? r.result : '';
              // Flush buffered deltas before finalizing
              if (streamTimerRef.current) {
                clearTimeout(streamTimerRef.current);
                streamTimerRef.current = null;
              }
              const pendingChunk = streamBufferRef.current;
              streamBufferRef.current = '';

              setChatMessages(prev => {
                const updated = [...prev];
                // Try to consolidate into the last streaming assistant message
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                  // Replace streaming content with the final content so deltas don't remain
                  const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                  last.content = finalContent;
                  last.isStreaming = false;
                } else if (textResult && textResult.trim()) {
                  updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
                }
                return updated;
              });
            } catch (e) {
              console.warn('Error handling cursor-result message:', e);
            }
          }

          // Store session ID for new sessions ONLY (to avoid refresh on every message)
          // Check pendingSessionId to ensure this is truly a new session
          const pendingCursorSessionId = sessionStorage.getItem('pendingSessionId');
          if (cursorCompletedSessionId && !currentSessionId && cursorCompletedSessionId === pendingCursorSessionId) {
            setCurrentSessionId(cursorCompletedSessionId);
            sessionStorage.removeItem('pendingSessionId');

            // Mark as system session change to preserve messages during navigation
            setIsSystemSessionChange(true);
            
            // Navigate to the new session immediately (like Claude does)
            // The projects_updated WebSocket message will handle sidebar refresh
            if (onNavigateToSession) {
              onNavigateToSession(cursorCompletedSessionId);
            }
          }
          break;

        case 'cursor-output':
          // Handle Cursor raw terminal output; strip ANSI and ignore empty control-only payloads
          try {
            const raw = String(latestMessage.data ?? '');
            const cleaned = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
            if (cleaned) {
              streamBufferRef.current += (streamBufferRef.current ? `\n${cleaned}` : cleaned);
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
            }
          } catch (e) {
            console.warn('Error handling cursor-output message:', e);
          }
          break;
          
        // CodeBuddy message handlers (similar to Cursor)
        case 'codebuddy-system':
          // Handle CodeBuddy system/init messages similar to Cursor
          try {
            const cbdata = latestMessage.data;
            if (cbdata && cbdata.type === 'system' && cbdata.subtype === 'init' && cbdata.session_id) {
              // If we already have a session and this differs, switch (duplication/redirect)
              if (currentSessionId && cbdata.session_id !== currentSessionId) {
                console.log('🔄 CodeBuddy session switch detected:', { originalSession: currentSessionId, newSession: cbdata.session_id });
                setIsSystemSessionChange(true);
                if (onNavigateToSession) {
                  onNavigateToSession(cbdata.session_id);
                }
              }
            }
          } catch (e) {
            console.warn('Error handling codebuddy-system message:', e);
          }
          break;

        case 'codebuddy-user':
          // Handle CodeBuddy user messages
          break;

        case 'codebuddy-error':
          // Use classified error message if available for user-friendly display
          const errorMessage = latestMessage.userMessage || latestMessage.error || 'Unknown error';
          const errorDetails = latestMessage.details?.raw || latestMessage.error;
          const errorType = latestMessage.errorType || 'unknown';
          
          setChatMessages(prev => [...prev, {
            type: 'error',
            content: `CodeBuddy error: ${errorMessage}`,
            errorType: errorType,
            errorDetails: errorDetails !== errorMessage ? errorDetails : null,
            timestamp: new Date()
          }]);
          
          // Log technical details for debugging
          if (errorDetails) {
            console.error('CodeBuddy error details:', { type: errorType, details: errorDetails });
          }
          break;
          
        case 'codebuddy-result':
          // Get session ID from message or fall back to current session
          const codebuddyCompletedSessionId = latestMessage.sessionId || currentSessionId;

          // Only update UI state if this is the current session
          if (codebuddyCompletedSessionId === currentSessionId) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }

          // Always mark the completed session as inactive and not processing
          if (codebuddyCompletedSessionId) {
            if (onSessionInactive) {
              onSessionInactive(codebuddyCompletedSessionId);
            }
            if (onSessionNotProcessing) {
              onSessionNotProcessing(codebuddyCompletedSessionId);
            }
          }

          // Only process result for current session
          if (codebuddyCompletedSessionId === currentSessionId) {
            try {
              const r = latestMessage.data || {};
              const textResult = typeof r.result === 'string' ? r.result : '';
              // Flush buffered deltas before finalizing
              if (streamTimerRef.current) {
                clearTimeout(streamTimerRef.current);
                streamTimerRef.current = null;
              }
              const pendingChunk = streamBufferRef.current;
              streamBufferRef.current = '';

              setChatMessages(prev => {
                const updated = [...prev];
                // Try to consolidate into the last streaming assistant message
                const last = updated[updated.length - 1];
                if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                  // Replace streaming content with the final content so deltas don't remain
                  const finalContent = textResult && textResult.trim() ? textResult : (last.content || '') + (pendingChunk || '');
                  last.content = finalContent;
                  last.isStreaming = false;
                } else if (textResult && textResult.trim()) {
                  updated.push({ type: r.is_error ? 'error' : 'assistant', content: textResult, timestamp: new Date(), isStreaming: false });
                }
                return updated;
              });
            } catch (e) {
              console.warn('Error handling codebuddy-result message:', e);
            }
          }

          // Store session ID for future use (for new sessions)
          const pendingCodeBuddySessionId = sessionStorage.getItem('pendingSessionId');
          if (codebuddyCompletedSessionId && !currentSessionId && codebuddyCompletedSessionId === pendingCodeBuddySessionId) {
            console.log('✅ New CodeBuddy session in codebuddy-result, ID set to:', codebuddyCompletedSessionId);
            setCurrentSessionId(codebuddyCompletedSessionId);
            sessionStorage.removeItem('pendingSessionId');

            // Mark as system session change to preserve messages during navigation
            setIsSystemSessionChange(true);
            
            // Navigate to the new session immediately
            // The projects_updated WebSocket message will handle sidebar refresh
            if (onNavigateToSession) {
              onNavigateToSession(codebuddyCompletedSessionId);
              console.log('🔄 Navigated to new CodeBuddy session in codebuddy-result:', codebuddyCompletedSessionId);
            }
          }
          break;

        case 'codebuddy-output':
          // Handle CodeBuddy raw terminal output; strip ANSI and ignore empty control-only payloads
          try {
            const cbraw = String(latestMessage.data ?? '');
            const cbcleaned = cbraw
              .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '') // Remove CSI sequences
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Remove other control chars
              .trim();
            if (cbcleaned) {
              streamBufferRef.current += (streamBufferRef.current ? `\n${cbcleaned}` : cbcleaned);
              if (!streamTimerRef.current) {
                streamTimerRef.current = setTimeout(() => {
                  const chunk = streamBufferRef.current;
                  streamBufferRef.current = '';
                  streamTimerRef.current = null;
                  if (!chunk) return;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                      last.content = last.content ? `${last.content}\n${chunk}` : chunk;
                    } else {
                      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
                    }
                    return updated;
                  });
                }, 100);
              }
            }
          } catch (e) {
            console.warn('Error handling codebuddy-output message:', e);
          }
          break;

        case 'codebuddy-complete':
          // Handle CodeBuddy session completion
          const cbCompletedSessionId = latestMessage.sessionId || currentSessionId;
          
          console.log('📋 codebuddy-complete received:', {
            messageSessionId: latestMessage.sessionId,
            currentSessionId: currentSessionId,
            isNewSession: latestMessage.isNewSession,
            exitCode: latestMessage.exitCode,
            pendingSessionId: sessionStorage.getItem('pendingSessionId')
          });

          // Update UI state if this is the current session
          if (cbCompletedSessionId === currentSessionId || !currentSessionId) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);

            // Fetch updated token usage after message completes (same as Claude)
            if (selectedProject && selectedSession?.id) {
              const fetchUpdatedTokenUsage = async () => {
                try {
                  const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
                  const response = await authenticatedFetch(url);
                  if (response.ok) {
                    const data = await response.json();
                    setTokenBudget(data);
                  }
                } catch (error) {
                  console.error('Failed to fetch updated token usage:', error);
                }
              };
              fetchUpdatedTokenUsage();
            }
            
            // Issue 9 fix: Clean up pending tool results to prevent memory leaks
            if (pendingToolResultsRef.current.size > 0) {
              console.log('🧹 Cleaning up pending tool results:', pendingToolResultsRef.current.size);
              pendingToolResultsRef.current.clear();
            }
            
            // Issue 10 fix: Flush any remaining stream buffer content
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            if (streamBufferRef.current) {
              const finalChunk = streamBufferRef.current;
              streamBufferRef.current = '';
              if (finalChunk.trim()) {
                setChatMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
                    last.content = (last.content || '') + finalChunk;
                    last.isStreaming = false;
                  } else {
                    updated.push({ type: 'assistant', content: finalChunk, timestamp: new Date(), isStreaming: false });
                  }
                  return updated;
                });
              }
            }
          }

          // Always mark the completed session as inactive and not processing
          if (cbCompletedSessionId) {
            // Mark as recently completed to prevent file watcher race conditions
            if (onSessionCompleted) {
              onSessionCompleted(cbCompletedSessionId, 'codebuddy');
            }
            if (onSessionInactive) {
              onSessionInactive(cbCompletedSessionId);
            }
            if (onSessionNotProcessing) {
              onSessionNotProcessing(cbCompletedSessionId);
            }
          }

          // Store session ID for new sessions ONLY if we don't have one yet
          // AND this is marked as a new session by the backend
          // Note: In most cases, codebuddy-result will have already set the session ID
          // This is a fallback in case the order is different
          if (latestMessage.isNewSession && cbCompletedSessionId && !currentSessionId) {
            const pendingCbSessionId = sessionStorage.getItem('pendingSessionId');
            
            // Only update if this matches the pending session
            if (cbCompletedSessionId === pendingCbSessionId) {
              console.log('✅ New CodeBuddy session complete (fallback), ID set to:', cbCompletedSessionId);
              setCurrentSessionId(cbCompletedSessionId);
              sessionStorage.removeItem('pendingSessionId');

              // Mark as system session change to preserve messages during navigation
              setIsSystemSessionChange(true);
              
              // Navigate to the new session immediately (like Claude does)
              // The projects_updated WebSocket message will handle sidebar refresh
              if (onNavigateToSession) {
                onNavigateToSession(cbCompletedSessionId);
              }
              
              console.log('🔄 Navigated to new CodeBuddy session (fallback):', cbCompletedSessionId);
            } else {
              console.log('⚠️ Session ID mismatch, NOT setting current session:', {
                completed: cbCompletedSessionId,
                pending: pendingCbSessionId
              });
            }
          } else {
            console.log('✅ CodeBuddy session complete, NO action needed:', {
              isNewSession: latestMessage.isNewSession,
              hasSessionId: !!cbCompletedSessionId,
              hasCurrentSessionId: !!currentSessionId
            });
          }
          break;
          
        case 'claude-complete':
          // Get session ID from message or fall back to current session
          const completedSessionId = latestMessage.sessionId || currentSessionId || sessionStorage.getItem('pendingSessionId');

          // Update UI state if this is the current session OR if we don't have a session ID yet (new session)
          if (completedSessionId === currentSessionId || !currentSessionId) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);

            // Fetch updated token usage after message completes
            if (selectedProject && selectedSession?.id) {
              const fetchUpdatedTokenUsage = async () => {
                try {
                  const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;
                  const response = await authenticatedFetch(url);
                  if (response.ok) {
                    const data = await response.json();
                    setTokenBudget(data);
                  }
                } catch (error) {
                  console.error('Failed to fetch updated token usage:', error);
                }
              };
              fetchUpdatedTokenUsage();
            }
          }

          // Always mark the completed session as inactive and not processing
          if (completedSessionId) {
            // Mark as recently completed to prevent file watcher race conditions
            if (onSessionCompleted) {
              onSessionCompleted(completedSessionId, 'claude');
            }
            if (onSessionInactive) {
              onSessionInactive(completedSessionId);
            }
            if (onSessionNotProcessing) {
              onSessionNotProcessing(completedSessionId);
            }
          }
          
          // If we have a pending session ID and the conversation completed successfully, use it
          const pendingSessionId = sessionStorage.getItem('pendingSessionId');
          if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
            setCurrentSessionId(pendingSessionId);
            sessionStorage.removeItem('pendingSessionId');

            // Mark as system session change to preserve messages during navigation
            setIsSystemSessionChange(true);
            
            // Navigate to the new session immediately
            // The projects_updated WebSocket message will handle sidebar refresh
            if (onNavigateToSession) {
              onNavigateToSession(pendingSessionId);
            }
            
            console.log('✅ New Claude session complete, ID set to:', pendingSessionId);
            console.log('🔄 Navigated to new Claude session:', pendingSessionId);
          }
          
          // Clear persisted chat messages after successful completion
          if (selectedProject && latestMessage.exitCode === 0) {
            safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
          }
          break;
          
        case 'session-aborted': {
          // Get session ID from message or fall back to current session
          const abortedSessionId = latestMessage.sessionId || currentSessionId;

          // Only update UI state if this is the current session
          if (abortedSessionId === currentSessionId) {
            setIsLoading(false);
            setCanAbortSession(false);
            setClaudeStatus(null);
          }

          // Always mark the aborted session as inactive and not processing
          if (abortedSessionId) {
            if (onSessionInactive) {
              onSessionInactive(abortedSessionId);
            }
            if (onSessionNotProcessing) {
              onSessionNotProcessing(abortedSessionId);
            }
          }

          setChatMessages(prev => [...prev, {
            type: 'assistant',
            content: 'Session interrupted by user.',
            timestamp: new Date()
          }]);
          break;
        }

        case 'session-status': {
          const statusSessionId = latestMessage.sessionId;
          const isCurrentSession = statusSessionId === currentSessionId ||
                                   (selectedSession && statusSessionId === selectedSession.id);
          if (isCurrentSession && latestMessage.isProcessing) {
            // Session is currently processing, restore UI state
            setIsLoading(true);
            setCanAbortSession(true);
            if (onSessionProcessing) {
              onSessionProcessing(statusSessionId);
            }
          }
          break;
        }

        case 'claude-status':
          // Handle Claude working status messages
          const statusData = latestMessage.data;
          if (statusData) {
            // Parse the status message to extract relevant information
            let statusInfo = {
              text: 'Working...',
              tokens: 0,
              can_interrupt: true
            };
            
            // Check for different status message formats
            if (statusData.message) {
              statusInfo.text = statusData.message;
            } else if (statusData.status) {
              statusInfo.text = statusData.status;
            } else if (typeof statusData === 'string') {
              statusInfo.text = statusData;
            }
            
            // Extract token count
            if (statusData.tokens) {
              statusInfo.tokens = statusData.tokens;
            } else if (statusData.token_count) {
              statusInfo.tokens = statusData.token_count;
            }
            
            // Check if can interrupt
            if (statusData.can_interrupt !== undefined) {
              statusInfo.can_interrupt = statusData.can_interrupt;
            }
            
            setClaudeStatus(statusInfo);
            setIsLoading(true);
            setCanAbortSession(statusInfo.can_interrupt);
          }
          break;
  
      }
    }
  }, [messages]);

  // Load file list when project changes
  useEffect(() => {
    if (selectedProject) {
      fetchProjectFiles();
    }
  }, [selectedProject]);

  const fetchProjectFiles = async () => {
    try {
      const response = await api.getFiles(selectedProject.name);
      if (response.ok) {
        const files = await response.json();
        // Flatten the file tree to get all file paths
        const flatFiles = flattenFileTree(files);
        setFileList(flatFiles);
      }
    } catch (error) {
      console.error('Error fetching files:', error);
    }
  };

  const flattenFileTree = (files, basePath = '') => {
    let result = [];
    for (const file of files) {
      const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
      if (file.type === 'directory' && file.children) {
        result = result.concat(flattenFileTree(file.children, fullPath));
      } else if (file.type === 'file') {
        result.push({
          name: file.name,
          path: fullPath,
          relativePath: file.path
        });
      }
    }
    return result;
  };

  // Handle @ symbol detection and file filtering
  useEffect(() => {
    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space after the @ symbol (which would end the file reference)
      if (!textAfterAt.includes(' ')) {
        setAtSymbolPosition(lastAtIndex);
        setShowFileDropdown(true);
        
        // Filter files based on the text after @
        const filtered = fileList.filter(file => 
          file.name.toLowerCase().includes(textAfterAt.toLowerCase()) ||
          file.path.toLowerCase().includes(textAfterAt.toLowerCase())
        ).slice(0, 10); // Limit to 10 results
        
        setFilteredFiles(filtered);
        setSelectedFileIndex(-1);
      } else {
        setShowFileDropdown(false);
        setAtSymbolPosition(-1);
      }
    } else {
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
    }
  }, [input, cursorPosition, fileList]);

  // Debounced input handling
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInput(input);
    }, 150); // 150ms debounce
    
    return () => clearTimeout(timer);
  }, [input]);

  // Show only recent messages for better performance
  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  // Capture scroll position before render when auto-scroll is disabled
  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop
      };
    }
  });

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollContainerRef.current && chatMessages.length > 0) {
      if (autoScrollToBottom) {
        // If auto-scroll is enabled, always scroll to bottom unless user has manually scrolled up
        if (!isUserScrolledUp) {
          setTimeout(() => scrollToBottom(), 50); // Small delay to ensure DOM is updated
        }
      } else {
        // When auto-scroll is disabled, preserve the visual position
        const container = scrollContainerRef.current;
        const prevHeight = scrollPositionRef.current.height;
        const prevTop = scrollPositionRef.current.top;
        const newHeight = container.scrollHeight;
        const heightDiff = newHeight - prevHeight;

        // If content was added above the current view, adjust scroll position
        if (heightDiff > 0 && prevTop > 0) {
          container.scrollTop = prevTop + heightDiff;
        }
      }
    }
  }, [chatMessages.length, isUserScrolledUp, scrollToBottom, autoScrollToBottom]);

  // Scroll to bottom when messages first load after session switch
  useEffect(() => {
    if (scrollContainerRef.current && chatMessages.length > 0 && !isLoadingSessionRef.current) {
      // Only scroll if we're not in the middle of loading a session
      // This prevents the "double scroll" effect during session switching
      // Reset scroll state when switching sessions
      setIsUserScrolledUp(false);
      setTimeout(() => {
        scrollToBottom();
        // After scrolling, the scroll event handler will naturally set isUserScrolledUp based on position
      }, 200); // Delay to ensure full rendering
    }
  }, [selectedSession?.id, selectedProject?.name]); // Only trigger when session/project changes

  // Add scroll event listener to detect user scrolling
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      // Touch events for mobile pull-down gesture
      scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
      scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
      // Wheel event for desktop scroll-up gesture
      scrollContainer.addEventListener('wheel', handleWheel, { passive: true });
      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll);
        scrollContainer.removeEventListener('touchstart', handleTouchStart);
        scrollContainer.removeEventListener('touchmove', handleTouchMove);
        scrollContainer.removeEventListener('wheel', handleWheel);
      };
    }
  }, [handleScroll, handleTouchStart, handleTouchMove, handleWheel]);

  // Initial textarea setup - set to 2 rows height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

      // Check if initially expanded
      const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
      const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
      setIsTextareaExpanded(isExpanded);
    }
  }, []); // Only run once on mount

  // Reset textarea height when input is cleared programmatically
  useEffect(() => {
    if (textareaRef.current && !input.trim()) {
      textareaRef.current.style.height = 'auto';
      setIsTextareaExpanded(false);
    }
  }, [input]);

  // Load token usage when session changes (but don't poll to avoid conflicts with WebSocket)
  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || selectedSession.id.startsWith('new-session-')) {
      // Reset for new/empty sessions
      setTokenBudget(null);
      return;
    }

    // Fetch token usage once when session loads
    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${selectedProject.name}/sessions/${selectedSession.id}/token-usage`;

        const response = await authenticatedFetch(url);

        if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedSession?.id, selectedProject?.path]);

  const handleTranscript = useCallback((text) => {
    if (text.trim()) {
      setInput(prevInput => {
        const newInput = prevInput.trim() ? `${prevInput} ${text}` : text;

        // Update textarea height after setting new content
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';

            // Check if expanded after transcript
            const lineHeight = parseInt(window.getComputedStyle(textareaRef.current).lineHeight);
            const isExpanded = textareaRef.current.scrollHeight > lineHeight * 2;
            setIsTextareaExpanded(isExpanded);
          }
        }, 0);

        return newInput;
      });
    }
  }, []);

  // Load earlier messages by increasing the visible message count
  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount(prevCount => prevCount + 100);
  }, []);

  // Handle image files from drag & drop or file picker
  const handleImageFiles = useCallback((files) => {
    const validFiles = files.filter(file => {
      try {
        // Validate file object and properties
        if (!file || typeof file !== 'object') {
          console.warn('Invalid file object:', file);
          return false;
        }

        if (!file.type || !file.type.startsWith('image/')) {
          return false;
        }

        if (!file.size || file.size > 5 * 1024 * 1024) {
          // Safely get file name with fallback
          const fileName = file.name || 'Unknown file';
          setImageErrors(prev => {
            const newMap = new Map(prev);
            newMap.set(fileName, 'File too large (max 5MB)');
            return newMap;
          });
          return false;
        }

        return true;
      } catch (error) {
        console.error('Error validating file:', error, file);
        return false;
      }
    });

    if (validFiles.length > 0) {
      setAttachedImages(prev => [...prev, ...validFiles].slice(0, 5)); // Max 5 images
    }
  }, []);

  // Handle clipboard paste for images
  const handlePaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData.items);
    
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          handleImageFiles([file]);
        }
      }
    }
    
    // Fallback for some browsers/platforms
    if (items.length === 0 && e.clipboardData.files.length > 0) {
      const files = Array.from(e.clipboardData.files);
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        handleImageFiles(imageFiles);
      }
    }
  }, [handleImageFiles]);

  // Setup dropzone
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']
    },
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 5,
    onDrop: handleImageFiles,
    noClick: true, // We'll use our own button
    noKeyboard: true
  });

  // Handle edit message
  const handleEditMessage = useCallback((messageIndex) => {
    // Prevent editing if already in edit mode or loading
    if (editingMessageIndex !== null || isLoading) return;
    
    const message = chatMessages[messageIndex];
    if (!message || message.type !== 'user') return;

    // Save original input in case user cancels
    setOriginalInput(input);
    
    // Fill input with message content
    setInput(message.content || '');
    
    // Mark this message as being edited
    setEditingMessageIndex(messageIndex);
    
    // Focus the input
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatMessages, input, editingMessageIndex, isLoading]);

  // Cancel editing
  const handleCancelEdit = useCallback(() => {
    // Restore original input
    setInput(originalInput);
    setEditingMessageIndex(null);
    setOriginalInput('');
  }, [originalInput]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !selectedProject) return;

    // Store editing state in local variable to avoid async state issues
    const wasEditing = editingMessageIndex !== null;

    // If editing a message, truncate first
    if (wasEditing) {
      const messageToEdit = chatMessages[editingMessageIndex];
      if (!messageToEdit || !messageToEdit.timestamp) {
        console.error('Cannot edit message: missing timestamp');
        setEditingMessageIndex(null);
        return;
      }

      try {
        // We need to find the message BEFORE the one being edited
        // to use as the truncation point
        const messageBeforeEdit = editingMessageIndex > 0 
          ? chatMessages[editingMessageIndex - 1] 
          : null;

        if (messageBeforeEdit && messageBeforeEdit.timestamp) {
          // Convert timestamp to ISO string
          let timestampISO = messageBeforeEdit.timestamp;
          if (typeof timestampISO === 'number') {
            timestampISO = new Date(timestampISO).toISOString();
          } else if (timestampISO instanceof Date) {
            timestampISO = timestampISO.toISOString();
          }

          // Truncate backend messages (keep messages up to and including the one before)
          const response = await authenticatedFetch(
            `/api/projects/${encodeURIComponent(selectedProject.name)}/sessions/${currentSessionId}/truncate`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                keepUntilTimestamp: timestampISO
              })
            }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to truncate session');
          }
        }

        // Truncate frontend messages - keep messages BEFORE the one being edited
        const truncatedMessages = chatMessages.slice(0, editingMessageIndex);
        setChatMessages(truncatedMessages);
        
      } catch (error) {
        console.error('Failed to truncate messages:', error);
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Failed to edit message: ${error.message}`,
          timestamp: new Date()
        }]);
        setEditingMessageIndex(null);
        setOriginalInput('');
        return;
      }
    }

    // Upload images first if any
    let uploadedImages = [];
    if (attachedImages.length > 0) {
      const formData = new FormData();
      attachedImages.forEach(file => {
        formData.append('images', file);
      });
      
      try {
        const response = await authenticatedFetch(`/api/projects/${selectedProject.name}/upload-images`, {
          method: 'POST',
          headers: {}, // Let browser set Content-Type for FormData
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to upload images');
        }
        
        const result = await response.json();
        uploadedImages = result.images;
      } catch (error) {
        console.error('Image upload failed:', error);
        setChatMessages(prev => [...prev, {
          type: 'error',
          content: `Failed to upload images: ${error.message}`,
          timestamp: new Date()
        }]);
        return;
      }
    }

    const userMessage = {
      type: 'user',
      content: input,
      images: uploadedImages,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setCanAbortSession(true);
    // Set a default status when starting
    setClaudeStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true
    });
    
    // Always scroll to bottom when user sends a message and reset scroll state
    setIsUserScrolledUp(false); // Reset scroll state so auto-scroll works for Claude's response
    setTimeout(() => scrollToBottom(), 100); // Longer delay to ensure message is rendered

    // Determine effective session id for replies to avoid race on state updates
    const effectiveSessionId = currentSessionId || selectedSession?.id || sessionStorage.getItem('cursorSessionId');

    // Session Protection: Mark session as active to prevent automatic project updates during conversation
    // Use existing session if available; otherwise a temporary placeholder until backend provides real ID
    const sessionToActivate = effectiveSessionId || `new-session-${Date.now()}`;
    if (onSessionActive) {
      onSessionActive(sessionToActivate);
    }

    // Get tools settings from localStorage based on provider
    const getToolsSettings = () => {
      try {
        const settingsKey = provider === 'cursor' ? 'cursor-tools-settings' : 'claude-settings';
        const savedSettings = safeLocalStorage.getItem(settingsKey);
        if (savedSettings) {
          return JSON.parse(savedSettings);
        }
      } catch (error) {
        console.error('Error loading tools settings:', error);
      }
      return {
        allowedTools: [],
        disallowedTools: [],
        skipPermissions: false
      };
    };

    const toolsSettings = getToolsSettings();

    // Send command based on provider
    if (provider === 'cursor') {
      // Send Cursor command (always use cursor-command; include resume/sessionId when replying)
      sendMessage({
        type: 'cursor-command',
        command: input,
        sessionId: effectiveSessionId,
        options: {
          // Prefer fullPath (actual cwd for project), fallback to path
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          sessionId: effectiveSessionId,
          resume: !!effectiveSessionId,
          model: cursorModel,
          skipPermissions: toolsSettings?.skipPermissions || false,
          toolsSettings: toolsSettings
        }
      });
    } else if (provider === 'codebuddy') {
      // Send CodeBuddy command (similar to Cursor)
      // Don't generate temp session ID - let CodeBuddy CLI create it
      sendMessage({
        type: 'codebuddy-command',
        command: input,
        sessionId: effectiveSessionId, // null for new sessions
        options: {
          cwd: selectedProject.fullPath || selectedProject.path,
          projectPath: selectedProject.fullPath || selectedProject.path,
          sessionId: effectiveSessionId, // null for new sessions
          resume: !!effectiveSessionId,
          model: codebuddyModel,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          images: uploadedImages // Pass images to backend (reserved for future CLI support)
        }
      });
    } else {
      // Send Claude command (existing code)
      sendMessage({
        type: 'claude-command',
        command: input,
        options: {
          projectPath: selectedProject.path,
          cwd: selectedProject.fullPath,
          sessionId: currentSessionId,
          resume: !!currentSessionId,
          toolsSettings: toolsSettings,
          permissionMode: permissionMode,
          images: uploadedImages // Pass images to backend
        }
      });
    }

    setInput('');
    setAttachedImages([]);
    setUploadingImages(new Map());
    setImageErrors(new Map());
    setIsTextareaExpanded(false);

    // Clear editing state after message is sent
    if (wasEditing) {
      setEditingMessageIndex(null);
      setOriginalInput('');
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Clear the saved draft since message was sent
    if (selectedProject) {
      safeLocalStorage.removeItem(`draft_input_${selectedProject.name}`);
    }
  }, [input, isLoading, selectedProject, attachedImages, currentSessionId, selectedSession, provider, permissionMode, onSessionActive, cursorModel, codebuddyModel, sendMessage, setInput, setAttachedImages, setUploadingImages, setImageErrors, setIsTextareaExpanded, textareaRef, setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setIsUserScrolledUp, scrollToBottom, chatMessages, editingMessageIndex, setEditingMessageIndex, setOriginalInput]);

  // Store handleSubmit in ref so handleCustomCommand can access it
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const selectCommand = (command) => {
    if (!command) return;

    // Prepare the input with command name and any arguments that were already typed
    const textBeforeSlash = input.slice(0, slashPosition);
    const textAfterSlash = input.slice(slashPosition);
    const spaceIndex = textAfterSlash.indexOf(' ');
    const textAfterQuery = spaceIndex !==-1 ? textAfterSlash.slice(spaceIndex) : '';

    const newInput = textBeforeSlash + command.name + ' ' + textAfterQuery;

    // Update input temporarily so executeCommand can parse arguments
    setInput(newInput);

    // Hide command menu
    setShowCommandMenu(false);
    setSlashPosition(-1);
    setCommandQuery('');
    setSelectedCommandIndex(-1);

    // Clear debounce timer
    if (commandQueryTimerRef.current) {
      clearTimeout(commandQueryTimerRef.current);
    }

    // Execute the command (which will load its content and send to Claude)
    executeCommand(command);
  };

  const handleKeyDown = (e) => {
    // Handle command menu navigation
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedCommandIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedCommandIndex >= 0) {
          selectCommand(filteredCommands[selectedCommandIndex]);
        } else if (filteredCommands.length > 0) {
          selectCommand(filteredCommands[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowCommandMenu(false);
        setSlashPosition(-1);
        setCommandQuery('');
        setSelectedCommandIndex(-1);
        if (commandQueryTimerRef.current) {
          clearTimeout(commandQueryTimerRef.current);
        }
        return;
      }
    }

    // Handle file dropdown navigation
    if (showFileDropdown && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev < filteredFiles.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedFileIndex(prev => 
          prev > 0 ? prev - 1 : filteredFiles.length - 1
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }
    
    // Handle Tab key for mode switching (only when dropdowns are not showing)
    if (e.key === 'Tab' && !showFileDropdown && !showCommandMenu) {
      e.preventDefault();
      const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
      const currentIndex = modes.indexOf(permissionMode);
      const nextIndex = (currentIndex + 1) % modes.length;
      const newMode = modes[nextIndex];
      setPermissionMode(newMode);

      // Save mode for this session
      if (selectedSession?.id) {
        localStorage.setItem(`permissionMode-${selectedSession.id}`, newMode);
      }
      return;
    }
    
    // Handle Enter key: Ctrl+Enter (Cmd+Enter on Mac) sends, Shift+Enter creates new line
    if (e.key === 'Enter') {
      // If we're in composition, don't send message
      if (e.nativeEvent.isComposing) {
        return; // Let IME handle the Enter key
      }
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        // Ctrl+Enter or Cmd+Enter: Send message
        e.preventDefault();
        handleSubmit(e);
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        // Plain Enter: Send message only if not in IME composition
        if (!sendByCtrlEnter) {
          e.preventDefault();
          handleSubmit(e);
        }
      }
      // Shift+Enter: Allow default behavior (new line)
    }
  };

  const selectFile = (file) => {
    const textBeforeAt = input.slice(0, atSymbolPosition);
    const textAfterAtQuery = input.slice(atSymbolPosition);
    const spaceIndex = textAfterAtQuery.indexOf(' ');
    const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';
    
    const newInput = textBeforeAt + '@' + file.path + ' ' + textAfterQuery;
    const newCursorPos = textBeforeAt.length + 1 + file.path.length + 1;
    
    // Immediately ensure focus is maintained
    if (textareaRef.current && !textareaRef.current.matches(':focus')) {
      textareaRef.current.focus();
    }
    
    // Update input and cursor position
    setInput(newInput);
    setCursorPosition(newCursorPos);
    
    // Hide dropdown
    setShowFileDropdown(false);
    setAtSymbolPosition(-1);
    
    // Set cursor position synchronously 
    if (textareaRef.current) {
      // Use requestAnimationFrame for smoother updates
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          // Ensure focus is maintained
          if (!textareaRef.current.matches(':focus')) {
            textareaRef.current.focus();
          }
        }
      });
    }
  };

  const handleInputChange = (e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    // Auto-select Claude provider if no session exists and user starts typing
    if (!currentSessionId && newValue.trim() && provider === 'claude') {
      // Provider is already set to 'claude' by default, so no need to change it
      // The session will be created automatically when they submit
    }

    setInput(newValue);
    setCursorPosition(cursorPos);

    // Handle height reset when input becomes empty
    if (!newValue.trim()) {
      e.target.style.height = 'auto';
      setIsTextareaExpanded(false);
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    // Detect slash command at cursor position
    // Look backwards from cursor to find a slash that starts a command
    const textBeforeCursor = newValue.slice(0, cursorPos);

    // Check if we're in a code block (simple heuristic: between triple backticks)
    const backticksBefore = (textBeforeCursor.match(/```/g) || []).length;
    const inCodeBlock = backticksBefore % 2 === 1;

    if (inCodeBlock) {
      // Don't show command menu in code blocks
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');
      return;
    }

    // Find the last slash before cursor that could start a command
    // Slash is valid if it's at the start or preceded by whitespace
    const slashPattern = /(^|\s)\/(\S*)$/;
    const match = textBeforeCursor.match(slashPattern);

    if (match) {
      const slashPos = match.index + match[1].length; // Position of the slash
      const query = match[2]; // Text after the slash

      // Update states with debouncing for query
      setSlashPosition(slashPos);
      setShowCommandMenu(true);
      setSelectedCommandIndex(-1);

      // Debounce the command query update
      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }

      commandQueryTimerRef.current = setTimeout(() => {
        setCommandQuery(query);
      }, 150); // 150ms debounce
    } else {
      // No slash command detected
      setShowCommandMenu(false);
      setSlashPosition(-1);
      setCommandQuery('');

      if (commandQueryTimerRef.current) {
        clearTimeout(commandQueryTimerRef.current);
      }
    }
  };

  const handleTextareaClick = (e) => {
    setCursorPosition(e.target.selectionStart);
  };



  const handleNewSession = () => {
    setChatMessages([]);
    setInput('');
    setIsLoading(false);
    setCanAbortSession(false);
  };
  
  const handleAbortSession = () => {
    if (currentSessionId && canAbortSession) {
      sendMessage({
        type: 'abort-session',
        sessionId: currentSessionId,
        provider: provider
      });
    }
  };

  const handleModeSwitch = () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
    const currentIndex = modes.indexOf(permissionMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    const newMode = modes[nextIndex];
    setPermissionMode(newMode);

    // Save mode for this session
    if (selectedSession?.id) {
      localStorage.setItem(`permissionMode-${selectedSession.id}`, newMode);
    }
  };

  // Don't render if no project is selected
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p>Select a project to start chatting with Claude</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          details[open] .details-chevron {
            transform: rotate(180deg);
          }
        `}
      </style>
      <div className="h-full flex flex-col">
        {/* Messages Area - Scrollable Middle Section */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-0 py-3 sm:p-4 space-y-3 sm:space-y-4 relative"
      >
        {isLoadingSessionMessages && chatMessages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
              <p>Loading session messages...</p>
            </div>
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            {!selectedSession && !currentSessionId && (
              <div className="text-center px-6 sm:px-4 py-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Choose Your AI Assistant</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-8">
                  Select a provider to start a new conversation
                </p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
                  {/* Claude Button */}
                  <button
                    onClick={() => {
                      setProvider('claude');
                      localStorage.setItem('selected-provider', 'claude');
                      // Focus input after selection
                      setTimeout(() => textareaRef.current?.focus(), 100);
                    }}
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
                    onClick={() => {
                      setProvider('cursor');
                      localStorage.setItem('selected-provider', 'cursor');
                      // Focus input after selection
                      setTimeout(() => textareaRef.current?.focus(), 100);
                    }}
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
                    onClick={() => {
                      setProvider('codebuddy');
                      localStorage.setItem('selected-provider', 'codebuddy');
                      // Focus input after selection
                      setTimeout(() => textareaRef.current?.focus(), 100);
                    }}
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
                    {provider === 'cursor' ? 'Select Model' : '\u00A0'}
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
                    ? 'Ready to use Claude AI. Start typing your message below.'
                    : provider === 'cursor'
                    ? `Ready to use Cursor with ${cursorModel}. Start typing your message below.`
                    : provider === 'codebuddy'
                    ? 'Ready to use CodeBuddy AI. Start typing your message below.'
                    : 'Select a provider above to begin'
                  }
                </p>
              </div>
            )}
            {selectedSession && (
              <div className="text-center text-gray-500 dark:text-gray-400 px-6 sm:px-4">
                <p className="font-bold text-lg sm:text-xl mb-3">Continue your conversation</p>
                <p className="text-sm sm:text-base leading-relaxed">
                  Ask questions about your code, request changes, or get help with development tasks
                </p>
              </div>
            )}
          </div>
        ) : (
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
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-2 border-b border-gray-200 dark:border-gray-700">
                {totalMessages > 0 && (
                  <span>
                    Showing {sessionMessages.length} of {totalMessages} messages • 
                    <span className="text-xs">Scroll up to load more</span>
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
                />
              );
            })}
          </>
        )}
        
        {isLoading && (
          <div className="chat-message assistant">
            <div className="w-full">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0 p-1 bg-transparent">
                  {(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? (
                    <CursorLogo className="w-full h-full" />
                  ) : (localStorage.getItem('selected-provider') || 'claude') === 'codebuddy' ? (
                    <CodeBuddyLogo className="w-full h-full" />
                  ) : (
                    <ClaudeLogo className="w-full h-full" />
                  )}
                </div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{(localStorage.getItem('selected-provider') || 'claude') === 'cursor' ? 'Cursor' : (localStorage.getItem('selected-provider') || 'claude') === 'codebuddy' ? 'CodeBuddy' : 'Claude'}</div>
                {/* Abort button removed - functionality not yet implemented at backend */}
              </div>
              <div className="w-full text-sm text-gray-500 dark:text-gray-400 pl-3 sm:pl-0">
                <div className="flex items-center space-x-1">
                  <div className="animate-pulse">●</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</div>
                  <span className="ml-2">Thinking...</span>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>


      {/* Input Area - Fixed Bottom */}
      <div className={`p-2 sm:p-4 md:p-4 flex-shrink-0 ${
        isInputFocused ? 'pb-2 sm:pb-4 md:pb-6' : 'pb-2 sm:pb-4 md:pb-6'
      }`}>
    
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
              onClick={handleModeSwitch}
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
                const isOpening = !showCommandMenu;
                setShowCommandMenu(isOpening);
                setCommandQuery('');
                setSelectedCommandIndex(-1);

                // When opening, ensure all commands are shown
                if (isOpening) {
                  setFilteredCommands(slashCommands);
                }

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
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInput('');
                  if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                    textareaRef.current.focus();
                  }
                  setIsTextareaExpanded(false);
                }}
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
                    onRemove={() => {
                      setAttachedImages(prev => prev.filter((_, i) => i !== index));
                    }}
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
                <span>Editing message - all messages after this will be deleted when you send</span>
              </div>
              <button
                onClick={handleCancelEdit}
                className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium text-sm transition-colors"
              >
                Cancel
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
              onPaste={handlePaste}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onInput={(e) => {
                // Immediate resize on input for better UX
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
                setCursorPosition(e.target.selectionStart);

                // Check if textarea is expanded (more than 2 lines worth of height)
                const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);
                const isExpanded = e.target.scrollHeight > lineHeight * 2;
                setIsTextareaExpanded(isExpanded);
              }}
              placeholder={`Type / for commands, @ for files, or ask ${provider === 'cursor' ? 'Cursor' : provider === 'codebuddy' ? 'CodeBuddy' : 'Claude'} anything...`}
              disabled={isLoading}
              className="chat-input-placeholder block w-full pl-12 pr-20 sm:pr-40 py-1.5 sm:py-4 bg-transparent rounded-2xl focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 disabled:opacity-50 resize-none min-h-[50px] sm:min-h-[80px] max-h-[40vh] sm:max-h-[300px] overflow-y-auto text-sm sm:text-base leading-[21px] sm:leading-6 transition-all duration-200 relative z-10"
              style={{ height: '50px' }}
            />
            {/* Image upload button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                open();
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
              type="button"
              onClick={(e) => {
                console.log('[Send Button] Click detected', { 
                  hasInput: !!input.trim(), 
                  isLoading, 
                  inputLength: input.length,
                  disabled: !input.trim() || isLoading 
                });
                e.preventDefault();
                e.stopPropagation();
                
                // Check if button should be disabled
                if (!input.trim() || isLoading) {
                  console.warn('[Send Button] Click ignored - button is disabled');
                  return;
                }
                
                // Manually trigger form submit
                const fakeEvent = { preventDefault: () => {} };
                handleSubmit(fakeEvent);
              }}
              onTouchStart={(e) => {
                // Prevent touch delay and ensure immediate response on mobile
                console.log('[Send Button] Touch start');
                e.stopPropagation();
              }}
              onTouchEnd={(e) => {
                console.log('[Send Button] Touch end', { 
                  hasInput: !!input.trim(), 
                  isLoading 
                });
                e.preventDefault();
                e.stopPropagation();
                
                // Check if button should be disabled
                if (!input.trim() || isLoading) {
                  console.warn('[Send Button] Touch ignored - button is disabled');
                  return;
                }
                
                // Manually trigger form submit on touch
                const fakeEvent = { preventDefault: () => {} };
                handleSubmit(fakeEvent);
              }}
              disabled={!input.trim() || isLoading}
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
                ? "Ctrl+Enter to send • Shift+Enter for new line • Tab to change modes • / for slash commands"
                : "Enter to send • Shift+Enter for new line • Tab to change modes • / for slash commands"}
            </div>
          </div>
        </form>
      </div>

      {/* Image Preview Modal */}
      {imagePreview && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => {
            // Only revoke blob URLs, not data URLs
            if (imagePreview.url.startsWith('blob:')) {
              URL.revokeObjectURL(imagePreview.url);
            }
            setImagePreview(null);
          }}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col">
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Only revoke blob URLs, not data URLs
                if (imagePreview.url.startsWith('blob:')) {
                  URL.revokeObjectURL(imagePreview.url);
                }
                setImagePreview(null);
              }}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Filename */}
            <div className="text-white text-sm mb-2 text-center">{imagePreview.filename}</div>
            
            {/* Image */}
            <img
              src={imagePreview.url}
              alt={imagePreview.filename}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Tool Result Modal */}
      {toolResultModal && (() => {
        const { message, toolName } = toolResultModal;
        // Support both data structures: legacy (toolResult.content) and new (toolResult.toolUseResult.content)
        const rawContent = message.toolResult?.toolUseResult?.content || message.toolResult?.content;
        const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
        const toolData = message.toolResult?.toolUseResult;

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 md:p-4"
            onClick={() => setToolResultModal(null)}
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
                  onClick={() => setToolResultModal(null)}
                  className="p-1.5 md:p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4 md:w-5 md:h-5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-3 md:p-4">
                {(() => {
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
                                    setToolResultModal(null);
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
                })()}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
    </>
  );
}

export default React.memo(ChatInterface);
