interface UploadProgressEvent {
  stage: 'preparing' | 'uploading' | 'processing' | 'complete';
  progress: number;
  message: string;
  key?: string;
}

interface ElectronAPI {
  send: (channel: string, data: any) => void;
  receive: (channel: string, func: (...args: any[]) => void) => (() => void) | undefined;
}

interface Window {
  api: ElectronAPI;
}