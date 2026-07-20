declare module 'printhub' {
  export default class PrintHub {
    constructor(options?: { paperSize?: string; printerType?: string });
    setPaperSize(paperSize: string): void;
    checkBluetooth(): Promise<boolean>;
    writeLineBreak(options?: { count?: number }): Promise<void>;
    writeDashLine(): Promise<void>;
    writeTextWith2Column(
      text1: string,
      text2: string,
      options?: { bold?: boolean; underline?: boolean; align?: string; size?: string },
    ): Promise<void>;
    writeText(
      text: string,
      options?: { bold?: boolean; underline?: boolean; align?: string; size?: string },
    ): Promise<void>;
    putImageWithUrl(
      url: string,
      options?: { align?: string; onFailed?: (message: string) => void },
    ): Promise<void>;
    connectToPrint(options: {
      onReady: (printer: PrintHub) => void;
      onFailed: (message: string) => void;
    }): Promise<void>;
  }
}
