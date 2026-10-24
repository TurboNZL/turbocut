import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.turbonzl.turbocut',
  appName: 'TurboCut',
  webDir: 'dist',
  // allowMixedContent: the app page is https://localhost and "Receive from a computer" fetches from the computer's http:// address on the local network.
  android: { allowMixedContent: true, webContentsDebuggingEnabled: true },
};

export default config;
