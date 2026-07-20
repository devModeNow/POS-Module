/**
 * Map template canvas Y% gap → blank lines for thermal/HTML print.
 * Editor canvas is ~100% tall; ~4.5% ≈ one text line.
 */
export function templateSpacingBlankLines(
  fromY: number,
  toY: number,
  previousBlockLines: number,
  nextContent?: string,
): number {
  const dy = Math.max(0, (toY ?? 0) - (fromY ?? 0));
  const slots = Math.round(dy / 4.5);
  let blanks = Math.max(0, Math.min(8, slots - Math.max(1, previousBlockLines)));
  // Always leave clear breathing room before the items section.
  if (isItemsTemplateBlock(nextContent)) {
    blanks = Math.max(blanks, 2);
  }
  return blanks;
}

export function isItemsTemplateBlock(content?: string): boolean {
  return /\{\{\s*items\s*\}\}/i.test(String(content ?? ''));
}

/** Blank lines after the company logo before the first template block. */
export function templateLogoBlankLines(firstElementY: number): number {
  return Math.max(1, Math.min(5, Math.round((firstElementY ?? 8) / 5)));
}

export function countTemplateBlockLines(text: string): number {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return Math.max(1, lines.length);
}
