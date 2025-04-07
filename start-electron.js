const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

const child = spawn(electron, ['.'], {
  stdio: 'inherit'
});

child.on('close', (code) => {
  process.exit(code);
});
