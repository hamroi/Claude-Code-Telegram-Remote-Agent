// PM2 process config — keeps the bot running in the background with auto-restart.
// Usage:
//   npm install -g pm2
//   pm2 start ecosystem.config.cjs
//   pm2 logs claude-telegram-bot
//   pm2 save        (persist across reboots)
module.exports = {
  apps: [
    {
      name: "claude-telegram-bot",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/index.ts",
      cwd: __dirname,
      autorestart: true,
      // Give a crashed process a few seconds before restarting.
      restart_delay: 3000,
      max_restarts: 50,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
