module.exports = {
  apps: [
    {
      name: 'myfinance',
      script: 'node_modules/.bin/next',
      args: 'start -p 4100',
      cwd: '/home/nasty68/myFinance',
      env: {
        NODE_ENV: 'production',
        PORT: 4100,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '1024M',
      node_args: '--max-old-space-size=1024',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'myfinance-bot',
      script: 'dist/bot/standalone.cjs',
      cwd: '/home/nasty68/myFinance',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      // SIGTERM → bot.stop() 의 long-poll abort 완료까지 시간 확보 (기본 1.6s → 15s)
      kill_timeout: 15000,
      // 재시작 사이 텔레그램 polling 세션 정리 시간 (409 Conflict 방지)
      restart_delay: 5000,
      // crash loop 방지 — 30초 안에 죽으면 crash 로 카운트, 10회 후 중단
      min_uptime: 30000,
      max_restarts: 10,
      max_memory_restart: '512M',
      node_args: '--max-old-space-size=512',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
