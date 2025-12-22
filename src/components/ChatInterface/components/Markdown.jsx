/**
 * Markdown Component
 * 
 * A wrapper component for ReactMarkdown with consistent configuration.
 */

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeInlineCodeFences } from '../utils';
import { markdownComponents } from './MarkdownComponents';

/**
 * Markdown renderer with GFM, math support, and custom components
 * @param {string} children - Markdown content to render
 * @param {string} className - Optional CSS class name
 */
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

export default Markdown;
