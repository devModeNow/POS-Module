import type { PosReceiptTemplateElement } from './pos-communications.service';

/**
 * Template canvas is 320px tall in the editor.
 */
export const TEMPLATE_CANVAS_HEIGHT_PX = 320;
/** Approximate thermal line height matching the editor font scale. */
export const TEMPLATE_PRINT_LINE_PX = 12;
/** Canvas Y% for one printed line (12px on 320px canvas). */
export const TEMPLATE_EDITOR_LINE_Y_PCT =
  (TEMPLATE_PRINT_LINE_PX / TEMPLATE_CANVAS_HEIGHT_PX) * 100;
/** Legacy % per line (used for logo leading). */
export const TEMPLATE_CANVAS_LINE_PCT = 10;

/**
 * Blank lines between blocks: gap from the bottom of the previous block to the
 * next block's top edge on the editor canvas (forward flow only).
 */
export function templateSpacingBlankLines(
  fromY: number,
  toY: number,
  previousBlockLines: number,
): number {
  const from = fromY ?? 0;
  const to = toY ?? 0;
  if (to <= from + 0.01) return 0;

  const prevEndPx =
    (from / 100) * TEMPLATE_CANVAS_HEIGHT_PX +
    Math.max(1, previousBlockLines) * TEMPLATE_PRINT_LINE_PX;
  const nextStartPx = (to / 100) * TEMPLATE_CANVAS_HEIGHT_PX;
  const gapPx = nextStartPx - prevEndPx;
  if (gapPx < TEMPLATE_PRINT_LINE_PX * 0.35) return 0;

  return Math.max(0, Math.min(8, Math.round(gapPx / TEMPLATE_PRINT_LINE_PX)));
}

/** Split one multiline block that mixes Total/Paid/Change into separate elements. */
export function splitMultilinePaymentBlocks(
  elements: PosReceiptTemplateElement[],
): PosReceiptTemplateElement[] {
  const out: PosReceiptTemplateElement[] = [];
  const yStep = TEMPLATE_EDITOR_LINE_Y_PCT;

  for (const el of elements) {
    if (el.type !== 'text') {
      out.push(el);
      continue;
    }

    const rawLines = String(el.content ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const paymentLines = rawLines.filter((l) => isPaymentSummaryBlock(l));

    if (paymentLines.length <= 1) {
      out.push(el);
      continue;
    }

    paymentLines.forEach((line, i) => {
      out.push({
        ...el,
        id: `${el.id}-pay${i}`,
        content: line,
        y: (el.y ?? 0) + i * yStep,
      });
    });

    const otherLines = rawLines.filter((l) => !isPaymentSummaryBlock(l));
    if (otherLines.length) {
      out.push({
        ...el,
        id: `${el.id}-rest`,
        content: otherLines.join('\n'),
        y: (el.y ?? 0) + paymentLines.length * yStep,
      });
    }
  }

  return out;
}

/** Normalize template elements for print (split merged payment lines, fix same-Y stacks). */
export function prepareTemplateElementsForPrint(
  elements: PosReceiptTemplateElement[],
): PosReceiptTemplateElement[] {
  return staggerPaymentBlocksAtSameY(splitMultilinePaymentBlocks(elements));
}

/** When payment blocks share the same Y, nudge each down so print spacing matches separation. */
export function staggerPaymentBlocksAtSameY(
  elements: PosReceiptTemplateElement[],
): PosReceiptTemplateElement[] {
  const sorted = sortTemplateElements(elements);
  const out = sorted.map((e) => ({ ...e }));
  const yStep = TEMPLATE_EDITOR_LINE_Y_PCT;

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const curr = out[i];
    if (
      isPaymentSummaryBlock(prev.content) &&
      isPaymentSummaryBlock(curr.content) &&
      (curr.y ?? 0) <= (prev.y ?? 0) + 0.01
    ) {
      out[i] = { ...curr, y: (prev.y ?? 0) + yStep };
    }
  }

  return out;
}

/** HTML spacer height matching thermal blank-line scale. */
export function templateSpacingHeightPx(blanks: number): number {
  if (blanks <= 0) return 0;
  return Math.round(blanks * TEMPLATE_PRINT_LINE_PX * 0.92);
}

export function isPaymentSummaryBlock(content?: string): boolean {
  const c = String(content ?? '');
  return (
    /\{\{\s*(total|amountPaid|change)\s*\}\}/i.test(c) ||
    /\b(total|paid|change)\s*:/i.test(c)
  );
}

/** Label left + amount right on one thermal line (e.g. Total: .... ₱100.00). */
export function formatPaymentSummaryLine(line: string, cols: number): string {
  const trimmed = line.trim();
  const m = trimmed.match(/^(.+?:)\s*(.+)$/);
  if (!m) return padReceiptLine(trimmed, cols, 'right');
  const label = m[1];
  const amount = m[2].trim();
  const gap = cols - label.length - amount.length;
  if (gap >= 1) return `${label}${' '.repeat(gap)}${amount}`;
  return `${label} ${amount}`.slice(0, cols);
}

export function isItemsTemplateBlock(content?: string): boolean {
  return /\{\{\s*items\s*\}\}/i.test(String(content ?? ''));
}

export function isTotalTemplateBlock(content?: string): boolean {
  const c = String(content ?? '');
  return /\{\{\s*total\s*\}\}/i.test(c) || /\btotal\s*:/i.test(c);
}

/** Blank lines after logo before the first template block (kept minimal). */
export function templateLogoBlankLines(firstElementY?: number): number {
  const y = firstElementY ?? 0;
  if (y <= 4) return 0;
  const firstStartPx = (y / 100) * TEMPLATE_CANVAS_HEIGHT_PX;
  const logoEndPx = 36;
  const gapPx = firstStartPx - logoEndPx;
  if (gapPx < TEMPLATE_PRINT_LINE_PX * 0.5) return 0;
  return Math.min(1, Math.round(gapPx / TEMPLATE_PRINT_LINE_PX));
}

export function countTemplateBlockLines(text: string): number {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return Math.max(1, lines.length);
}

/** Thermal column count from paper width. */
export function receiptColumnCount(paperWidth?: string): number {
  return String(paperWidth ?? '80mm').includes('58') ? 32 : 42;
}

/** Space-pad a line for thermal printers (use align:left when printing). */
export function padReceiptLine(
  text: string,
  cols: number,
  align: 'left' | 'center' | 'right',
): string {
  const t = text.length > cols ? text.slice(0, cols) : text;
  if (align === 'center') {
    const pad = Math.max(0, Math.floor((cols - t.length) / 2));
    return `${' '.repeat(pad)}${t}`;
  }
  if (align === 'right') {
    const pad = Math.max(0, cols - t.length);
    return `${' '.repeat(pad)}${t}`;
  }
  return t;
}

/** Infer text alignment from template canvas X%. */
export function alignFromTemplateX(x?: number): 'left' | 'center' | 'right' {
  const pos = x ?? 0;
  if (pos >= 67) return 'right';
  if (pos >= 34) return 'center';
  return 'left';
}

/** Canvas X% for a chosen alignment (keeps editor + print in sync). */
export function xFromTemplateAlign(align?: 'left' | 'center' | 'right'): number {
  if (align === 'right') return 92;
  if (align === 'center') return 50;
  return 8;
}

/** Sort template elements top-to-bottom for print. */
export function sortTemplateElements(elements: PosReceiptTemplateElement[]): PosReceiptTemplateElement[] {
  return [...elements].sort(
    (a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0),
  );
}

/** Shared canvas style for template editor + print preview panel. */
export function receiptPreviewElementStyle(el: PosReceiptTemplateElement): Record<string, string> {
  const align = el.align ?? alignFromTemplateX(el.x);

  if (el.type === 'text' && isPaymentSummaryBlock(el.content)) {
    return {
      position: 'absolute',
      left: '4%',
      right: '4%',
      top: `${el.y}%`,
      width: '92%',
      transform: 'none',
      fontSize: `${el.fontSize ?? 12}px`,
      fontWeight: el.bold ? '700' : '400',
      textAlign: 'left',
    };
  }

  const transforms: string[] = [];
  if (align === 'center') transforms.push('translateX(-50%)');
  else if (align === 'right') transforms.push('translateX(-100%)');
  return {
    position: 'absolute',
    left: `${el.x}%`,
    top: `${el.y}%`,
    transform: transforms.join(' ') || 'none',
    fontSize: `${el.fontSize ?? 12}px`,
    fontWeight: el.bold ? '700' : '400',
    textAlign: align,
    maxWidth: el.type === 'image' ? `${el.width ?? 40}%` : '90%',
  };
}

export function parsePaymentPreviewParts(
  content: string | undefined,
  renderedText: string,
): { label: string; amount: string } | null {
  if (!isPaymentSummaryBlock(content)) return null;
  const m = String(renderedText ?? '').trim().match(/^(.+?:)\s*(.+)$/);
  if (!m) return null;
  return { label: m[1], amount: m[2].trim() };
}
