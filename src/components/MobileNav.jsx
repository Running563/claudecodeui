import React from 'react';
import { MessageSquare, Folder, Terminal, GitBranch, Globe, CheckSquare, MonitorPlay } from 'lucide-react';

function MobileNav({ activeTab, setActiveTab, onOpenTerminals, selectedProject, preferredSessionView }) {
  // chat 和 shell 合并为一个标签，显示当前选中的图标
  const isChatOrShell = activeTab === 'chat' || activeTab === 'shell';
  
  const navItems = [
    {
      id: 'chat-shell',
      // 根据当前 activeTab 或用户偏好显示对应图标
      icon: isChatOrShell 
        ? (activeTab === 'shell' ? Terminal : MessageSquare)
        : (preferredSessionView === 'shell' ? Terminal : MessageSquare),
      onClick: () => {
        // 如果已经在 chat 或 shell，保持当前状态
        if (!isChatOrShell) {
          // 使用用户保存的偏好视图
          setActiveTab(preferredSessionView || 'chat');
        }
      },
      isActive: isChatOrShell
    },
    {
      id: 'files',
      icon: Folder,
      onClick: () => setActiveTab('files')
    },
    {
      id: 'git',
      icon: GitBranch,
      onClick: () => setActiveTab('git')
    },
    {
      id: 'terminals',
      icon: MonitorPlay,
      onClick: () => setActiveTab('terminals')
    }
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-background z-50 ios-bottom-safe shadow-lg"
    >
      <div className="flex items-center justify-around">
        {navItems.map((item) => {
          // Hide items that require a project when no project is selected
          if (item.requiresProject && !selectedProject) {
            return null;
          }
          
          const Icon = item.icon;
          const isActive = item.isActive !== undefined ? item.isActive : activeTab === item.id;
          
          return (
            <button
              key={item.id}
              onClick={item.onClick}
              className={`vk-btn flex items-center justify-center p-1.5 rounded-lg min-h-[32px] min-w-[40px] touch-manipulation ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
              aria-label={item.id}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MobileNav;