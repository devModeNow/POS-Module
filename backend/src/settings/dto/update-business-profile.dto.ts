import { Allow } from 'class-validator';

/**
 * Every field must be decorated so Nest ValidationPipe (`whitelist: true`)
 * does not strip the request body. `@Allow()` marks properties as allowed
 * without strict type checks (booleans/nulls from the UI are fine).
 */
export class UpdateBusinessProfileDto {
  @Allow() websiteTabName?: string | null;
  @Allow() routingTabName?: string | null;
  @Allow() businessName?: string | null;
  @Allow() businessAddress?: string | null;
  @Allow() businessContact?: string | null;
  @Allow() businessEmail?: string | null;
  @Allow() businessOwner?: string | null;
  @Allow() businessDescription?: string | null;
  @Allow() businessLogo?: string | null;
  @Allow() businessLogoLight?: string | null;
  @Allow() businessLogoDark?: string | null;
  @Allow() drTemplatePdf?: string | null;
  @Allow() printPaperSize?: string | null;
  @Allow() printShowLogo?: string | null;
  @Allow() printLogoVariant?: string | null;
  @Allow() printFooterText?: string | null;
  @Allow() printQuoteHeaderColor?: string | null;
  @Allow() printQuoteShowTerms?: string | null;
  @Allow() printQuoteShowMisc?: string | null;
  @Allow() printQuoteShowValidity?: string | null;
  @Allow() printSoShowDiscount?: string | null;
  @Allow() printSoShowPaymentTerms?: string | null;
  @Allow() printSoShowSerials?: string | null;
  @Allow() printDrShowSerials?: string | null;
  @Allow() printDrShowSignature?: string | null;
  @Allow() printReportShowHeader?: string | null;
  @Allow() printCvShowPreparedBy?: string | null;
  @Allow() printCvShowSignatureLine?: string | null;
  @Allow() printAddressDetails?: string | null;
  @Allow() printAddressShowSoInvoice?: string | null;
  @Allow() printAddressShowQuotation?: string | null;
  @Allow() printAddressShowDr?: string | null;
  @Allow() printAddressShowAccounting?: string | null;
  @Allow() printSignaturePreparedBy?: string | null;
  @Allow() printSignatureCheckedBy?: string | null;
  @Allow() printSignatureApprovedBy?: string | null;
  @Allow() cvNumberPrefix?: string | null;
  @Allow() cvNumberSuffix?: string | null;
  @Allow() gjNumberPrefix?: string | null;
  @Allow() gjNumberSuffix?: string | null;
  @Allow() posReceiptPaperWidth?: string | null;
  @Allow() posReceiptShowLogo?: string | boolean | null;
  @Allow() posReceiptFooterText?: string | null;
  @Allow() posPrinterName?: string | null;
  @Allow() posReceiptTemplateJson?: string | null;
  @Allow() posPrinterConnectionType?: string | null;
  @Allow() posPrinterHost?: string | null;
  @Allow() posPrinterPort?: string | null;
  @Allow() posPrinterUsbVendorId?: string | null;
  @Allow() posPrinterUsbProductId?: string | null;
  @Allow() posPrinterUsbProductName?: string | null;
  @Allow() posPrinterBtDeviceId?: string | null;
  @Allow() posPrinterBtDeviceName?: string | null;
  @Allow() posCashDrawerEnabled?: string | boolean | null;
  @Allow() posCashDrawerOpenOn?: string | null;
}
