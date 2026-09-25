import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.frameloom.animator',
  appName: 'Frameloom',
  webDir: 'dist',
  backgroundColor: '#121218',
  android: {
    // Keep the WebView tidy: no remote content, no mixed content.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
