declare global {
  interface Window {
    electronAPI: {
      send: (channel: string, ...args: unknown[]) => void;
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}

declare module '*.png' {
  const src: string;
  export default src;
}

export {};
