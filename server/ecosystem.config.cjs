module.exports = {
  apps: [{
    name: 'shadow-cipher-sponsor',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--import tsx/esm',
    cwd: '/opt/shadow-cipher/server',
    env_file: '/opt/shadow-cipher/.env',
    restart_delay: 5000,
    max_restarts: 10,
    out_file: '/home/ec2-user/.pm2/logs/shadow-cipher-out.log',
    error_file: '/home/ec2-user/.pm2/logs/shadow-cipher-error.log',
  }],
};
