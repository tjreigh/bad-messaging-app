module.exports = {
  apps: [
    {
      name: "bma",
      script: "dist/server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3002"
      },
      autorestart: true,
      max_memory_restart: "256M",
      time: true
    }
  ]
};
