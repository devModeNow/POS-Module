import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

type OrgSettingsRow = {
  id: string;
  orgId: string;
  websiteTabName: string | null;
  routingTabName: string | null;
  businessName: string | null;
  businessAddress: string | null;
  businessContact: string | null;
  businessEmail: string | null;
  businessOwner: string | null;
  businessDescription: string | null;
  businessLogo: string | null;
  businessLogoLight: string | null;
  businessLogoDark: string | null;
  drTemplatePdf: string | null;
  printPaperSize: string | null;
  printShowLogo: string | null;
  printLogoVariant: string | null;
  printFooterText: string | null;
  printQuoteHeaderColor: string | null;
  printQuoteShowTerms: string | null;
  printQuoteShowMisc: string | null;
  printQuoteShowValidity: string | null;
  printSoShowDiscount: string | null;
  printSoShowPaymentTerms: string | null;
  printSoShowSerials: string | null;
  printDrShowSerials: string | null;
  printDrShowSignature: string | null;
  printReportShowHeader: string | null;
  printAddressDetails: string | null;
  printAddressShowSoInvoice: string | null;
  printAddressShowQuotation: string | null;
  printAddressShowDr: string | null;
  printSignaturePreparedBy: string | null;
  printSignatureCheckedBy: string | null;
  printSignatureApprovedBy: string | null;
  posReceiptPaperWidth: string | null;
  posReceiptShowLogo: string | null;
  posReceiptFooterText: string | null;
  posPrinterName: string | null;
  posReceiptTemplateJson: string | null;
};

const EMPTY_SETTINGS: OrgSettingsRow = {
  id: '0', orgId: '0',
  websiteTabName: null, routingTabName: null,
  businessName: null, businessAddress: null, businessContact: null,
  businessEmail: null, businessOwner: null, businessDescription: null,
  businessLogo: null, businessLogoLight: null, businessLogoDark: null,
  drTemplatePdf: null, printPaperSize: null, printShowLogo: null,
  printLogoVariant: null, printFooterText: null, printQuoteHeaderColor: null,
  printQuoteShowTerms: null, printQuoteShowMisc: null, printQuoteShowValidity: null,
  printSoShowDiscount: null, printSoShowPaymentTerms: null, printSoShowSerials: null,
  printDrShowSerials: null, printDrShowSignature: null, printReportShowHeader: null,
  printAddressDetails: null, printAddressShowSoInvoice: null,
  printAddressShowQuotation: null, printAddressShowDr: null,
  printSignaturePreparedBy: null, printSignatureCheckedBy: null,
  printSignatureApprovedBy: null,
  posReceiptPaperWidth: null, posReceiptShowLogo: null, posReceiptFooterText: null,
  posPrinterName: null, posReceiptTemplateJson: null,
};

@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------------------
  // Public helper — resolves the first active org when no orgId is provided
  // (used by the public endpoint before login)
  // ---------------------------------------------------------------------------
  private async resolveOrgId(orgId?: number | null): Promise<number | null> {
    if (orgId && orgId > 0) return orgId;
    const posOrg = await this.db.query<{ id: number }>(
      `SELECT id FROM tblorganizations
       WHERE is_active = true AND code IN ('point-of-sales', 'pos')
       ORDER BY id ASC LIMIT 1`,
    );
    if (posOrg.rows[0]?.id) return posOrg.rows[0].id;

    const withLogo = await this.db.query<{ id: number }>(
      `SELECT o.id
       FROM tblorganizations o
       INNER JOIN tblorg_settings s ON s.org_id = o.id
       WHERE o.is_active = true
         AND (NULLIF(TRIM(s.logo_light), '') IS NOT NULL OR NULLIF(TRIM(s.logo_dark), '') IS NOT NULL)
       ORDER BY o.id ASC LIMIT 1`,
    );
    if (withLogo.rows[0]?.id) return withLogo.rows[0].id;

    const result = await this.db.query<{ id: number }>(
      `SELECT id FROM tblorganizations WHERE is_active = true ORDER BY id ASC LIMIT 1`,
    );
    return result.rows[0]?.id ?? null;
  }

  private schemaReady = false;

  private async ensureOrgSettingsSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.query(`
      ALTER TABLE public.tblorg_settings
        ADD COLUMN IF NOT EXISTS business_description TEXT,
        ADD COLUMN IF NOT EXISTS pos_receipt_paper_width TEXT DEFAULT '80mm',
        ADD COLUMN IF NOT EXISTS pos_receipt_show_logo BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS pos_receipt_footer_text TEXT,
        ADD COLUMN IF NOT EXISTS pos_printer_name TEXT,
        ADD COLUMN IF NOT EXISTS pos_receipt_template_json TEXT
    `);
    this.schemaReady = true;
  }

  private async ensureOrgSettingsRow(orgId: number): Promise<void> {
    await this.ensureOrgSettingsSchema();
    await this.db.query(
      `INSERT INTO tblorg_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`,
      [orgId],
    );
  }

  // ---------------------------------------------------------------------------
  // SELECT
  // ---------------------------------------------------------------------------
  async getBusinessProfile(orgId?: number | null) {
    try {
      await this.ensureOrgSettingsSchema();
      const resolvedOrgId = await this.resolveOrgId(orgId);
      if (!resolvedOrgId) return { success: true, item: EMPTY_SETTINGS };

      const result = await this.db.query<OrgSettingsRow>(
        `SELECT
           s.id::text                       AS id,
           s.org_id::text                   AS "orgId",
           s.website_tab_name               AS "websiteTabName",
           s.routing_tab_name               AS "routingTabName",
           s.business_name                  AS "businessName",
           s.business_address               AS "businessAddress",
           s.business_contact               AS "businessContact",
           s.business_email                 AS "businessEmail",
           s.business_owner                 AS "businessOwner",
           s.business_description           AS "businessDescription",
           NULL                             AS "businessLogo",
           s.logo_light                     AS "businessLogoLight",
           s.logo_dark                      AS "businessLogoDark",
           s.dr_template_pdf                AS "drTemplatePdf",
           s.print_paper_size               AS "printPaperSize",
           s.print_show_logo                AS "printShowLogo",
           s.print_logo_variant             AS "printLogoVariant",
           s.print_footer_text              AS "printFooterText",
           s.print_quote_header_color       AS "printQuoteHeaderColor",
           s.print_quote_show_terms         AS "printQuoteShowTerms",
           s.print_quote_show_misc          AS "printQuoteShowMisc",
           s.print_quote_show_validity      AS "printQuoteShowValidity",
           s.print_so_show_discount         AS "printSoShowDiscount",
           s.print_so_show_payment_terms    AS "printSoShowPaymentTerms",
           s.print_so_show_serials          AS "printSoShowSerials",
           s.print_dr_show_serials          AS "printDrShowSerials",
           s.print_dr_show_signature        AS "printDrShowSignature",
           NULL                             AS "printReportShowHeader",
           s.print_address_details          AS "printAddressDetails",
           s.print_address_show_so_invoice  AS "printAddressShowSoInvoice",
           s.print_address_show_quotation   AS "printAddressShowQuotation",
           s.print_address_show_dr          AS "printAddressShowDr",
           s.print_signature_prepared_by    AS "printSignaturePreparedBy",
           s.print_signature_checked_by     AS "printSignatureCheckedBy",
           s.print_signature_approved_by    AS "printSignatureApprovedBy",
           s.pos_receipt_paper_width        AS "posReceiptPaperWidth",
           s.pos_receipt_show_logo          AS "posReceiptShowLogo",
           s.pos_receipt_footer_text        AS "posReceiptFooterText",
           s.pos_printer_name               AS "posPrinterName",
           s.pos_receipt_template_json      AS "posReceiptTemplateJson"
         FROM tblorg_settings s
         WHERE s.org_id = $1
         LIMIT 1`,
        [resolvedOrgId],
      );

      return { success: true, item: result.rows[0] ?? EMPTY_SETTINGS };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to load settings' };
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------
  async updateBusinessProfile(dto: UpdateBusinessProfileDto, orgId?: number | null) {
    try {
      const resolvedOrgId = await this.resolveOrgId(orgId);
      if (!resolvedOrgId) return { success: false, message: 'No active organization found' };

      await this.ensureOrgSettingsRow(resolvedOrgId);

      if (dto.posReceiptShowLogo !== undefined) {
        const boolVal = String(dto.posReceiptShowLogo).trim().toLowerCase() === 'true';
        await this.db.query(
          `UPDATE tblorg_settings SET pos_receipt_show_logo = $1, updated_at = NOW() WHERE org_id = $2`,
          [boolVal, resolvedOrgId],
        );
      }

      const fieldMap: Record<string, string> = {
        websiteTabName:           'website_tab_name',
        routingTabName:           'routing_tab_name',
        businessName:             'business_name',
        businessAddress:          'business_address',
        businessContact:          'business_contact',
        businessEmail:            'business_email',
        businessOwner:            'business_owner',
        businessDescription:      'business_description',
        businessLogoLight:        'logo_light',
        businessLogoDark:         'logo_dark',
        drTemplatePdf:            'dr_template_pdf',
        printPaperSize:           'print_paper_size',
        printShowLogo:            'print_show_logo',
        printLogoVariant:         'print_logo_variant',
        printFooterText:          'print_footer_text',
        printQuoteHeaderColor:    'print_quote_header_color',
        printQuoteShowTerms:      'print_quote_show_terms',
        printQuoteShowMisc:       'print_quote_show_misc',
        printQuoteShowValidity:   'print_quote_show_validity',
        printSoShowDiscount:      'print_so_show_discount',
        printSoShowPaymentTerms:  'print_so_show_payment_terms',
        printSoShowSerials:       'print_so_show_serials',
        printDrShowSerials:       'print_dr_show_serials',
        printDrShowSignature:     'print_dr_show_signature',
        printAddressDetails:      'print_address_details',
        printAddressShowSoInvoice:'print_address_show_so_invoice',
        printAddressShowQuotation:'print_address_show_quotation',
        printAddressShowDr:       'print_address_show_dr',
        printSignaturePreparedBy: 'print_signature_prepared_by',
        printSignatureCheckedBy:  'print_signature_checked_by',
        printSignatureApprovedBy: 'print_signature_approved_by',
        posReceiptPaperWidth:     'pos_receipt_paper_width',
        posReceiptFooterText:     'pos_receipt_footer_text',
        posPrinterName:           'pos_printer_name',
        posReceiptTemplateJson:   'pos_receipt_template_json',
      };

      const sets: string[] = [];
      const values: unknown[] = [];

      for (const [dtoKey, col] of Object.entries(fieldMap)) {
        if ((dto as Record<string, unknown>)[dtoKey] === undefined) continue;
        const raw = (dto as Record<string, unknown>)[dtoKey];
        const val = raw === null ? null : String(raw).trim() || null;
        values.push(val);
        sets.push(`"${col}" = $${values.length}`);
      }

      if (sets.length > 0) {
        sets.push(`"updated_at" = NOW()`);
        values.push(resolvedOrgId);
        await this.db.query(
          `UPDATE tblorg_settings SET ${sets.join(', ')} WHERE org_id = $${values.length}`,
          values,
        );
      }

      return this.getBusinessProfile(resolvedOrgId);
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to update settings' };
    }
  }

  // ---------------------------------------------------------------------------
  // UPLOAD ASSET (logo / signature / DR template)
  // ---------------------------------------------------------------------------
  async uploadBusinessAsset(
    key: 'businessLogoLight' | 'businessLogoDark' | 'drTemplatePdf' |
         'printSignaturePreparedBy' | 'printSignatureCheckedBy' | 'printSignatureApprovedBy',
    file: any,
    orgId?: number | null,
  ) {
    if (!file?.buffer || file.size <= 0) return { success: false, message: 'File is required' };

    if (key === 'drTemplatePdf' && !String(file.mimetype ?? '').toLowerCase().includes('pdf')) {
      return { success: false, message: 'Only PDF files are allowed for DR template' };
    }
    if (key !== 'drTemplatePdf' && !String(file.mimetype ?? '').toLowerCase().startsWith('image/')) {
      return { success: false, message: 'Only image files are allowed for logo upload' };
    }

    const mimeType = String(file.mimetype ?? 'application/octet-stream').trim();
    const dataUrl = `data:${mimeType};base64,${(file.buffer as Buffer).toString('base64')}`;

    return this.updateBusinessProfile({ [key]: dataUrl } as UpdateBusinessProfileDto, orgId);
  }
}
