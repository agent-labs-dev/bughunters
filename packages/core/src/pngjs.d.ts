declare module 'pngjs' {
  export const PNG: {
    new (options: { width: number; height: number }): { data: Buffer; width: number; height: number };
    sync: {
      read(bytes: Buffer): { data: Buffer; width: number; height: number };
      write(image: { data: Buffer; width: number; height: number }): Buffer;
    };
  };
}
