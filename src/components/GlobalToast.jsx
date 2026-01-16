/**
 * GlobalToast - 全局命令式 Toast 组件
 * 
 * 使用方式：
 *   import { toast } from '@/components/GlobalToast';
 *   toast.show('消息内容');
 * 
 * 特点：
 *   - 命令式 API，无需管理状态
 *   - 全局单例，在 App.jsx 中挂载
 *   - 显示位置：屏幕中下部 (bottom-33vh)
 *   - 自动 2 秒消失
 * 
 * 注：如需 Props 驱动的 Toast，请使用 ./Toast.jsx
 */

import { useEffect, useState, useRef } from 'react';

let showFn = null;

function GlobalToast() {
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    showFn = (msg) => {
      setMessage(msg);
      // 清除之前的定时器
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // 设置新的定时器
      timerRef.current = setTimeout(() => setMessage(''), 2000);
    };
    return () => { 
      showFn = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed bottom-[33vh] left-1/2 -translate-x-1/2 z-[9999] animate-slide-down">
      <div className="bg-gray-800 dark:bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg border border-gray-700 whitespace-nowrap text-sm font-medium">
        {message}
      </div>
    </div>
  );
}

export const toast = {
  show: (msg) => showFn?.(msg) ?? console.warn('GlobalToast not mounted')
};

export default GlobalToast;
