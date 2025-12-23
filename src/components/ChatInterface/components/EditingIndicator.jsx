/**
 * EditingIndicator - Shows when user is editing a previous message
 * 
 * Displays a warning that sending will truncate messages after the edited one
 */

import React, { memo } from 'react';

function EditingIndicator({ editingMessageIndex, handleCancelEdit }) {
  if (editingMessageIndex === null) {
    return null;
  }

  return (
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
  );
}

export default memo(EditingIndicator);
