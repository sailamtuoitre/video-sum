const { spawn, execSync } = require('node:child_process');

const shellCommand = process.platform === 'win32' ? 'cmd.exe' : 'sh';
const shellFlag = process.platform === 'win32' ? '/c' : '-c';

function killPort(port) {
  try {
    if (process.platform === 'win32') {
      const result = execSync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port}"`,
        { encoding: 'utf-8' },
      );
      const pids = new Set(
        result
          .split('\n')
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && pid !== '0'),
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          console.log(`Killed process ${pid} on port ${port}`);
        } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    }
  } catch {}
}

killPort(3000);
killPort(5173);

const processes = [
  {
    name: 'backend',
    childProcess: spawn(shellCommand, [shellFlag, 'npm run start:dev'], {
      stdio: 'inherit',
      shell: false,
    }),
  },
  {
    name: 'frontend',
    childProcess: spawn(shellCommand, [shellFlag, 'npm --prefix frontend run dev'], {
      stdio: 'inherit',
      shell: false,
    }),
  },
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const { childProcess } of processes) {
    if (!childProcess.killed) {
      childProcess.kill();
    }
  }

  process.exit(exitCode);
}

for (const { name, childProcess } of processes) {
  childProcess.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`${name} stopped with exit code ${code ?? 1}`);
      shutdown(code ?? 1);
    }
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
