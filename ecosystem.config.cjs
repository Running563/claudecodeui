module.exports = {
  apps: [
    {
      name: 'ccui',
      script: './server/index.js',
      instances: 1,
      exec_mode: 'fork',
      
      // 日志配置
      error_file: '/root/.pm2/logs/ccui-error.log',
      out_file: '/root/.pm2/logs/ccui-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      
      // 环境变量
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      
      // 进程管理
      watch: false,
      max_memory_restart: '1G',
      
      // 自动重启配置
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
    {
      name: 'ccui-dev',
      script: 'npm',
      args: 'run dev',
      instances: 1,
      exec_mode: 'fork',
      
      // 日志配置
      error_file: '/root/.pm2/logs/ccui-dev-error.log',
      out_file: '/root/.pm2/logs/ccui-dev-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      
      // 环境变量
      env: {
        NODE_ENV: 'development',
      },
      
      // 进程管理
      watch: false,
      autorestart: true,
    }
  ]
};
