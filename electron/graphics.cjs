// Video decoding on the graphics card (Linux). Chromium decodes HEVC only through VA-API, and NVIDIA's own driver has no VA-API.
// `nvidia-vaapi-driver` (a separate package: nvidia_drv_video.so) translates VA-API into NVDEC, which a GeForce card has for HEVC. When that
// file is installed this sets what Chromium needs to use it; without it nothing changes and the ffmpeg conversion (transcode.cjs) is the way.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const DIRS = ['/usr/lib/x86_64-linux-gnu/dri', '/usr/lib64/dri', '/usr/lib/dri', '/usr/lib/aarch64-linux-gnu/dri', '/run/opengl-driver/lib/dri'];

/** The path of the NVIDIA VA-API driver, or null. */
function nvidiaDriver(dirs = DIRS, exists = fs.existsSync) {
  for (const d of dirs) if (exists(`${d}/nvidia_drv_video.so`)) return `${d}/nvidia_drv_video.so`;
  return null;
}

/** Environment and Chromium switches for the NVIDIA VA-API driver. Does nothing when the person set their own LIBVA_DRIVER_NAME. */
function setupNvidia(app, env = process.env, found = nvidiaDriver()) {
  if (!found || env.LIBVA_DRIVER_NAME) return false;
  env.LIBVA_DRIVER_NAME = 'nvidia';
  env.NVD_BACKEND = env.NVD_BACKEND || 'direct'; // the driver's recommended back end for Chromium
  app.commandLine.appendSwitch('disable-gpu-sandbox'); // the driver talks to /dev/nvidia*, which the GPU sandbox blocks
  return true;
}

const run = (cmd, args, ms = 8000) =>
  new Promise((resolve) => {
    let s = '';
    try {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      const t = setTimeout(() => (p.kill(), resolve(s + '\n(timed out)')), ms);
      p.stdout.on('data', (c) => (s += c));
      p.stderr.on('data', (c) => (s += c));
      p.on('error', () => (clearTimeout(t), resolve(null)));
      p.on('exit', () => (clearTimeout(t), resolve(s)));
    } catch {
      resolve(null);
    }
  });

/** A text report: what the system offers for HEVC, and whether the pieces TurboCut uses are there. */
async function report(gpuProbe) {
  const lines = ['TurboCut video decoding report', `Platform: ${process.platform}`];
  if (process.platform === 'linux') {
    lines.push(`LIBVA_DRIVER_NAME: ${process.env.LIBVA_DRIVER_NAME || '(not set)'}`, `NVIDIA VA-API driver (nvidia-vaapi-driver): ${nvidiaDriver() || 'not installed'}`);
    const va = await run('vainfo', []);
    if (va == null) lines.push('vainfo: not installed (install the vainfo package to see what VA-API offers)');
    else {
      const hevc = va.split('\n').filter((l) => /HEVC|H265|Main/i.test(l) && /VAProfile/.test(l));
      lines.push(`VA-API HEVC profiles: ${hevc.length ? hevc.map((l) => l.trim()).join(' | ') : 'none listed'}`, ...(/error|failed/i.test(va) && !hevc.length ? [`vainfo said: ${va.trim().split('\n').slice(0, 4).join(' / ')}`] : []));
    }
  }
  if (gpuProbe) lines.push(`ffmpeg on the graphics card: ${gpuProbe.nvenc && gpuProbe.cuda ? 'NVDEC + NVENC available (conversions use the GPU)' : 'not available (conversions use the CPU)'}`);
  return lines.join('\n');
}

module.exports = { nvidiaDriver, setupNvidia, report, DIRS };
