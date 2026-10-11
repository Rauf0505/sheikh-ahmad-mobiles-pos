import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  send: (channel: string, ...args: unknown[]) => {
    console.log('[PRELOAD SEND]', channel, args);
    ipcRenderer.send(channel, ...args);
  },
  invoke: (channel: string, ...args: unknown[]) => {
    console.log('[PRELOAD INVOKE]', channel, args);
    return ipcRenderer.invoke(channel, ...args).then(
      (res) => { console.log('[PRELOAD RESULT]', channel, res); return res; },
      (err) => { console.log('[PRELOAD ERROR]', channel, err); throw err; }
    );
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
