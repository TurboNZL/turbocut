// Whether the window is drawn by the theme (the engine's window-frame module) or by the system.
// Some Linux desktops (GNOME on Wayland) give an Electron window no title bar at all, so the drawn frame is the default
// everywhere except macOS, whose traffic lights are part of the system frame.
const fs = require('node:fs');
const path = require('node:path');

const file = (dir) => path.join(dir, 'desktop.json');

function loadFrame(dir, platform = process.platform) {
  let on = platform !== 'darwin';
  try {
    const v = JSON.parse(fs.readFileSync(file(dir), 'utf8')).customFrame;
    if (typeof v === 'boolean') on = v && platform !== 'darwin';
  } catch {
    /* no file yet: the default */
  }
  return on;
}

function saveFrame(dir, on) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
  } catch {
    /* new file */
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify({ ...all, customFrame: on === true }));
}

module.exports = { loadFrame, saveFrame };
