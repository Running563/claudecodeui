/**
 * Toast - Props 驱动的 Toast 通知组件
 * 
 * 使用方式：
 *   const [show, setShow] = useState(false);
 *   {show && <Toast message="消息" onClose={() => setShow(false)} />}
 * 
 * 特点：
 *   - Props 驱动，需要父组件管理状态
 *   - 显示位置：屏幕顶部 (top-4)
 *   - 适合局部使用场景
 * 
 * 注：如需全局命令式 Toast，请使用 ./GlobalToast.jsx
 */

import React, { useEffect } from 'react';

function Toast({ message, onClose, duration = 2000 }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[9999] animate-slide-down">
      <div className="bg-gray-800 dark:bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg border border-gray-700">
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
}

export default Toast;
