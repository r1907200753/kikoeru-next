import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kikoeruDesktop', {
  platform: process.platform,
  setPlaybackActive: (active: boolean): void => {
    ipcRenderer.send('kikoeru:playback-active', active === true);
  },
});
