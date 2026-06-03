/** Per-unit display for legacy register rows that still store purchase_qty > 1. */

function parseQty(qty: string | null | undefined): number | null {
  if (qty == null || qty === "") return null;
  const q = Number.parseFloat(qty);
  return Number.isFinite(q) ? q : null;
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number.parseFloat(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function divideStoredAmount(
  amount: number,
  qty: number
): number {
  const scale = 10000;
  const totalScaled = Math.round(amount * scale);
  const perUnitScaled = Math.round(totalScaled / qty);
  return perUnitScaled / scale;
}

export function isLegacyMultiUnitQty(qty: string | null | undefined): boolean {
  const q = parseQty(qty);
  return q != null && q > 1;
}

export function perUnitQtyDisplay(qty: string | null | undefined): string {
  const q = parseQty(qty);
  if (q == null) return "—";
  if (q > 1) return "1";
  return qty ?? "—";
}

export function perUnitRateDisplay(
  qty: string | null | undefined,
  unitRate: string | null | undefined
): string {
  if (unitRate == null || unitRate === "") return "—";
  return unitRate;
}

export function perUnitPurchaseAmount(
  qty: string | null | undefined,
  unitRate: string | null | undefined
): number | null {
  const q = parseQty(qty);
  const r = parseAmount(unitRate);
  if (q == null || r == null) return null;
  if (q > 1) return r;
  if (q < 0 || r < 0) return null;
  return q * r;
}

export function perUnitBookValue(params: {
  purchaseQty: string | null | undefined;
  bookValue?: string | null;
  oldBookValue?: string | null;
  unitRate?: string | null;
}): number | null {
  const q = parseQty(params.purchaseQty);
  if (q != null && q > 1) {
    const book = parseAmount(params.bookValue);
    if (book != null && book > 0) {
      return divideStoredAmount(book, q);
    }
    const oldBook = parseAmount(params.oldBookValue);
    if (oldBook != null && oldBook > 0) {
      return divideStoredAmount(oldBook, q);
    }
    return perUnitPurchaseAmount(params.purchaseQty, params.unitRate);
  }

  const book = parseAmount(params.bookValue);
  if (book != null && book > 0) return book;
  const oldBook = parseAmount(params.oldBookValue);
  if (oldBook != null && oldBook > 0) return oldBook;
  return perUnitPurchaseAmount(params.purchaseQty, params.unitRate);
}

export function perUnitStoredBookValue(
  purchaseQty: string | null | undefined,
  bookValue: string | null | undefined
): string {
  const q = parseQty(purchaseQty);
  const book = parseAmount(bookValue);
  if (q == null || q <= 1 || book == null || book <= 0) {
    return bookValue ?? "";
  }
  return String(divideStoredAmount(book, q));
}

export function perUnitStoredAmount(
  purchaseQty: string | null | undefined,
  storedAmount: string | null | undefined
): number | null {
  const q = parseQty(purchaseQty);
  const total = parseAmount(storedAmount);
  if (q == null || total == null) return null;
  if (q > 1) return divideStoredAmount(total, q);
  return total;
}
