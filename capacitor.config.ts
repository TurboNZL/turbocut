import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.turbonzl.turbocut',
  appName: 'TurboCut',
  webDir: 'dist',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: true },
};

export default config;
