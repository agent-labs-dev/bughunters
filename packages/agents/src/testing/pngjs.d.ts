declare module 'pngjs' {
  export const PNG: {
    new (options: { width: number; height: number }): { data: Buffer };
    sync: { write(image: { data: Buffer }): Buffer };
  };
}
