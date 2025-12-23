/**
 * FileDropdown - File selection dropdown for @ mentions
 * 
 * Displays a list of files matching the user's search query
 * with keyboard navigation support
 */

import React, { memo } from 'react';

function FileDropdown({
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  selectFile
}) {
  if (!showFileDropdown || filteredFiles.length === 0) {
    return null;
  }

  return (
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
  );
}

export default memo(FileDropdown);
