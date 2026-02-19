module.exports = {
  apps: [
    {
      name: "analytics",
      script: "server.js",
      cwd: "/home/cdd/analytics",

      instances: 1,
      exec_mode: "fork",

      watch: false,

      env: {
        NODE_ENV: "production",
        PORT: 3020
      },

      max_memory_restart: "300M",
      restart_delay: 2000,

      log_date_format: "YYYY-MM-DD HH:mm:ss",
    }
  ]
};

