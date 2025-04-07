import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("api", {
  send: (channel: string, data: any) => {
    const validChannels = ["audio-data", "get-audio-history", "delete-audio", "transcribe-audio"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel: string, func: (...args: any[]) => void) => {
    const validChannels = [
      "upload-status", 
      "audio-history", 
      "upload-progress", 
      "transcription-status", 
      "transcription-progress"
    ];
    if (validChannels.includes(channel)) {
      const subscription = (_event: IpcRendererEvent, ...args: any[]) => func(...args);
      ipcRenderer.on(channel, subscription);
      
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    return undefined;
  }
});