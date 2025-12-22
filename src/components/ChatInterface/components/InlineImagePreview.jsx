/**
 * InlineImagePreview Component
 * 
 * A reusable component for displaying image previews in tool results.
 */

import React, { memo } from 'react';

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

export default InlineImagePreview;
