declare module '@point-of-sale/receipt-printer-encoder' {
  export type ReceiptPrinterEncoderOptions = {
    language?: string;
    columns?: number;
  };

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);
    initialize(): this;
    codepage(value: string): this;
    text(value: string): this;
    newline(): this;
    cut(): this;
    encode(): Uint8Array | number[];
  }
}
