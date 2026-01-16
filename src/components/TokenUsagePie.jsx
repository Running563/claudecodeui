import React from 'react';

function TokenUsagePie({ used, total }) {
  // Token usage visualization component
  // Only bail out on missing values or non‐positive totals; allow used===0 to render 0%
 if (used == null || total == null || total <= 0) return null;

  const percentage = Math.min(100, (used / total) * 100);

  // 格式化 token 数量为 K 单位（无小数）
  const formatTokens = (tokens) => {
    return Math.floor(tokens / 1000) + 'K';
  };

  return (
    <span 
      className="text-xs text-gray-500 dark:text-gray-400"
      title={`${used.toLocaleString()} / ${total.toLocaleString()} tokens`}
    >
      {percentage.toFixed(1)}%{used > 0 && ` (${formatTokens(used)})`}
    </span>
  );
}

export default TokenUsagePie;
