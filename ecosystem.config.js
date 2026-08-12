module.exports = {
  apps: [
    {
      name: 'champ-spot-tool',
      script: 'server/dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 8080
      },
      // Restart on crash, up to 10 times before giving up temporarily
      max_restarts: 10,
      restart_delay: 4000,
      // Merge logs into single files
      merge_logs: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true
    }
  ]
};
