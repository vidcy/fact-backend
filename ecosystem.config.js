module.exports = {
  apps: [
    {
      name: 'fact-backend',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
      },
    },
  ],
};
