import { ipcMain, app } from 'electron';
import { getDatabase } from '../db/connection.js';
import path from 'node:path';
import fs from 'node:fs';

// ESC/POS thermal printer module
// Uses node-thermal-printer for buffer building and @maxxuxx/node-printer for Windows Spooler output

interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  discount?: number;
}

interface ReceiptData {
  orderId: number;
  billId: number;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  cashierName: string;
  customerName?: string;
  saleType: string;
  timestamp: string;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  businessNTN?: string;
  receiptHeader?: string;
  receiptFooter?: string;
}

interface ConsolidatedReceiptSummary {
  sales_count: number;
  subtotal: number;
  discount_amount: number;
  total: number;
}

interface ConsolidatedReceiptData {
  dateFrom: string;
  dateTo: string;
  products: Array<{ name: string; qty: number; amount: number }>;
  summary: ConsolidatedReceiptSummary;
  payment_split: Array<{ method: string; count: number; amount: number }>;
  businessName?: string;
  businessPhone?: string;
  businessAddress?: string;
  businessNTN?: string;
  receiptHeader?: string;
  receiptFooter?: string;
}

function methodLabel(m: string): string {
  return m === 'cash' ? 'CASH' : m === 'card' ? 'CARD' : m === 'jazzcash' ? 'JAZZCASH' : m === 'easypaisa' ? 'EASYPAISA' : m === 'bank_transfer' ? 'BANK TRANSFER' : 'CREDIT';
}

// ─── PRINTER SETTINGS ──────────────────────────────────────────────
function getPrinterSettings(): { type: string; connection: string; printerName: string } {
  try {
    const db = getDatabase();
    const row = db.prepare(`SELECT key, value FROM app_settings WHERE key IN ('printer_type', 'printer_interface', 'printer_name')`).all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const r of row) settings[r.key] = r.value;
    return {
      type: settings.printer_type || 'epson',
      connection: settings.printer_interface || 'usb',
      printerName: (settings.printer_name || 'Black Copper 80').trim(),
    };
  } catch {
    return { type: 'epson', connection: 'usb', printerName: 'Black Copper 80' };
  }
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── LOGO PATH RESOLUTION ──────────────────────────────────────────
function getLogoPath(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'logo.png'),
    path.join(app.getAppPath(), 'resources', 'logo.png'),
    path.join(process.resourcesPath || '', 'logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── RESIZE LOGO FOR PRINTER (80mm / 576 dots wide) ───────────────
const MAX_LOGO_WIDTH = 250;
const MAX_LOGO_HEIGHT = 280;

function readResizedLogo(logoPath: string): { width: number; height: number; pngBuffer: Buffer } | null {
  try {
    const { PNG } = require('pngjs');
    const png = PNG.sync.read(fs.readFileSync(logoPath));

    let scale = Math.min(
      MAX_LOGO_WIDTH / png.width,
      MAX_LOGO_HEIGHT / png.height,
      1, // never upscale
    );

    const newW = Math.max(1, Math.round(png.width * scale));
    const newH = Math.max(1, Math.round(png.height * scale));

    // Nearest-neighbor resize
    const out = Buffer.alloc(newW * newH * 4);
    for (let y = 0; y < newH; y++) {
      const srcY = Math.min(png.height - 1, Math.floor(y / scale));
      for (let x = 0; x < newW; x++) {
        const srcX = Math.min(png.width - 1, Math.floor(x / scale));
        const sIdx = (srcY * png.width + srcX) * 4;
        const dIdx = (y * newW + x) * 4;
        out[dIdx] = png.data[sIdx];
        out[dIdx + 1] = png.data[sIdx + 1];
        out[dIdx + 2] = png.data[sIdx + 2];
        out[dIdx + 3] = png.data[sIdx + 3];
      }
    }

    // Encode resized RGBA data back into a PNG buffer
    const resizedPng = new PNG({ width: newW, height: newH });
    resizedPng.data = out;
    const pngBuffer = PNG.sync.write(resizedPng);

    return { width: newW, height: newH, pngBuffer };
  } catch {
    return null;
  }
}

// ─── CREATE PRINTER BUFFER (ESC/POS only, no transport) ────────────
async function createPrinterBuffer() {
  const { ThermalPrinter, PrinterTypes } = await import('node-thermal-printer');
  const settings = getPrinterSettings();

  const typeMap: Record<string, any> = {
    epson: PrinterTypes.EPSON,
    blackcopper: PrinterTypes.EPSON,
    star: PrinterTypes.STAR,
    tanca: PrinterTypes.TANCA,
    daruma: PrinterTypes.DARUMA,
    brother: PrinterTypes.BROTHER,
  };

  return new ThermalPrinter({
    type: typeMap[settings.type] || PrinterTypes.EPSON,
    interface: 'usb', // required by type; transport is handled by @maxxuxx/node-printer
    width: 48,
    removeSpecialCharacters: false,
  });
}

// ─── SEND BUFFER TO PRINTER VIA WINDOWS SPOOLER ────────────────────
async function sendToPrinter(buffer: Buffer): Promise<void> {
  const printer = await import('@maxxuxx/node-printer');
  const settings = getPrinterSettings();

  await printer.print(
    { type: 'winspool', printerName: settings.printerName, documentName: 'POS Receipt' },
    buffer,
  );
}

// ─── CHECK PRINTER CONNECTION VIA WINDOWS SPOOLER ──────────────────
async function checkPrinterConnection(): Promise<{ success: boolean; connected: boolean; error?: string }> {
  try {
    const printer = await import('@maxxuxx/node-printer');
    const settings = getPrinterSettings();
    const printers = await printer.listPrinters('winspool');
    const found = printers.find((p: any) => p.name === settings.printerName);
    if (found) {
      return { success: true, connected: true };
    }
    const available = printers.map((p: any) => p.name).join(', ');
    return { success: false, connected: false, error: `Printer "${settings.printerName}" not found. Available: ${available || 'none'}` };
  } catch (err: any) {
    return { success: false, connected: false, error: err.message || 'Printer not found' };
  }
}

// ─── BUILD RECEIPT ─────────────────────────────────────────────────
async function buildReceipt(printer: any, data: ReceiptData) {
  const WIDTH = printer.getWidth(); // 48 chars for 80mm

  // ─── HEADER ────────────────────────────────────────────────────────
  printer.alignCenter();

  const logoPath = getLogoPath();
  const resizedLogo = logoPath ? readResizedLogo(logoPath) : null;
  const brand = data.businessName || 'Sheikh Ahmad Mobiles';
  if (resizedLogo) {
    try {
      printer.printImageBuffer(resizedLogo.pngBuffer);
      printer.newLine();
      printer.setTextDoubleHeight();
      printer.bold(true);
      printer.println(brand);
      printer.bold(false);
      printer.setTextNormal();
    } catch {
      printer.setTextDoubleHeight();
      printer.bold(true);
      printer.println(brand);
      printer.bold(false);
      printer.setTextNormal();
    }
  } else {
    printer.setTextDoubleHeight();
    printer.bold(true);
    printer.println(brand);
    printer.bold(false);
    printer.setTextNormal();
  }

  const contactParts: string[] = [];
  if (data.businessPhone) contactParts.push(data.businessPhone);
  if (data.businessAddress) contactParts.push(data.businessAddress);
  if (contactParts.length > 0) {
    printer.alignCenter();
    printer.println(contactParts.join(' | '));
  }

  if (data.businessNTN) {
    printer.println(`NTN: ${data.businessNTN}`);
  }

  printer.newLine();
  printer.bold(true);
  printer.println('~ Invoice ~');
  printer.bold(false);
  printer.newLine();

  // ─── SEPARATOR ─────────────────────────────────────────────────────
  printer.drawLine('-');

  // ─── ORDER INFO ────────────────────────────────────────────────────
  printer.alignLeft();
  printer.leftRight(`Order: #${data.orderId}`, `Bill: #${data.billId}`);
  printer.println(`Date:   ${data.timestamp}`);
  printer.println(`Cashier: ${data.cashierName}`);
  if (data.customerName) {
    printer.println(`Customer: ${data.customerName}`);
  }

  const saleTypeLabel = data.saleType === 'wholesale' ? 'Wholesale' : 'Retail';
  printer.println(`Sale: ${saleTypeLabel}`);

  // ─── SEPARATOR ─────────────────────────────────────────────────────
  printer.drawLine('-');

  // ─── ITEMS ─────────────────────────────────────────────────────────
  for (const item of data.items) {
    const itemTotal = item.price * item.qty - (item.discount || 0);
    const label = `${item.qty}x ${item.name}`;
    printer.leftRight(label, formatCurrency(itemTotal));
    if (item.discount && item.discount > 0) {
      printer.leftRight(`  Discount:`, `-${formatCurrency(item.discount)}`);
    }
  }

  // ─── SEPARATOR ─────────────────────────────────────────────────────
  printer.drawLine('-');

  // ─── TOTALS ────────────────────────────────────────────────────────
  printer.leftRight('Subtotal:', formatCurrency(data.subtotal));
  if (data.discountAmount > 0) {
    printer.leftRight('Discount:', `-${formatCurrency(data.discountAmount)}`);
  }

  // Double line for total
  printer.drawLine('=');
  printer.bold(true);
  printer.leftRight('TOTAL:', formatCurrency(data.total));
  printer.bold(false);
  printer.drawLine('=');

  // ─── PAYMENT ───────────────────────────────────────────────────────
  printer.newLine();
  const methodLabel = data.paymentMethod === 'cash' ? 'CASH' : data.paymentMethod === 'card' ? 'CARD' : data.paymentMethod === 'jazzcash' ? 'JAZZCASH' : data.paymentMethod === 'easypaisa' ? 'EASYPAISA' : data.paymentMethod === 'bank_transfer' ? 'BANK TRANSFER' : 'CREDIT';
  printer.leftRight('Payment:', methodLabel);

  // ─── FOOTER ────────────────────────────────────────────────────────
  printer.newLine();
  printer.alignCenter();
  printer.println(data.receiptHeader || 'Thank you for shopping with us!');
  if (data.receiptFooter) {
    printer.println(data.receiptFooter);
  }

  // ─── SOFTWARE CREATOR CREDIT ──────────────────────────────────
  printer.newLine();
  printer.drawLine('-');
  printer.alignCenter();
  printer.println('Developed by Abdul Rauf | 03336982272');

  // ─── CUT ───────────────────────────────────────────────────────────
  printer.newLine();
  printer.cut();
}

// ─── PRINT RECEIPT ──────────────────────────────────────────────────
async function printReceipt(data: ReceiptData): Promise<{ success: boolean; error?: string }> {
  try {
    const printer = await createPrinterBuffer();
    await buildReceipt(printer, data);
    const buffer = printer.getBuffer();

    await sendToPrinter(buffer);
    return { success: true };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error('[Printer] Print failed:', msg);
    console.log(`=== RECEIPT (Bill #${data.billId}) ===`);
    console.log(buildTextReceipt(data));
    console.log('=====================================');
    return { success: false, error: msg };
  }
}

// ─── PRINT CONSOLIDATED RETAIL RECEIPT (DAY CLOSE) ─────────────────
async function printConsolidatedReceipts(data: ConsolidatedReceiptData): Promise<{ success: boolean; error?: string }> {
  try {
    const printer = await createPrinterBuffer();

    // ─── HEADER ──────────────────────────────────────────────────────
    printer.alignCenter();
    const logoPath = getLogoPath();
    const resizedLogo = logoPath ? readResizedLogo(logoPath) : null;
    const brand = data.businessName || 'Sheikh Ahmad Mobiles';
    if (resizedLogo) {
      try {
        printer.printImageBuffer(resizedLogo.pngBuffer);
      } catch {
        printer.setTextDoubleHeight();
        printer.bold(true);
        printer.println(brand);
        printer.bold(false);
        printer.setTextNormal();
      }
    } else {
      printer.setTextDoubleHeight();
      printer.bold(true);
      printer.println(brand);
      printer.bold(false);
      printer.setTextNormal();
    }

    const contactParts: string[] = [];
    if (data.businessPhone) contactParts.push(data.businessPhone);
    if (data.businessAddress) contactParts.push(data.businessAddress);
    if (contactParts.length > 0) {
      printer.alignCenter();
      printer.println(contactParts.join(' | '));
    }
    if (data.businessNTN) {
      printer.println(`NTN: ${data.businessNTN}`);
    }

    printer.newLine();
    printer.bold(true);
    printer.println('~ RETAIL SALES RECEIPT ~');
    printer.bold(false);
    printer.println(`Period: ${data.dateFrom}${data.dateTo && data.dateTo !== data.dateFrom ? ` - ${data.dateTo}` : ''}`);
    printer.newLine();
    printer.drawLine('-');

    // ─── PRODUCTS (everything sold, aggregated) ──────────────────────
    printer.alignLeft();
    for (const p of data.products) {
      printer.leftRight(`${p.qty} x ${p.name}`, formatCurrency(p.amount));
    }

    printer.drawLine('-');

    // ─── SUMMARY ─────────────────────────────────────────────────────
    printer.leftRight('Retail Sales:', String(data.summary.sales_count));
    printer.leftRight('Subtotal:', formatCurrency(data.summary.subtotal));
    if (data.summary.discount_amount > 0) {
      printer.leftRight('Discount:', `-${formatCurrency(data.summary.discount_amount)}`);
    }

    printer.drawLine('=');
    printer.bold(true);
    printer.leftRight('TOTAL:', formatCurrency(data.summary.total));
    printer.bold(false);
    printer.drawLine('=');

    // ─── PAYMENT BREAKDOWN ──────────────────────────────────────────
    if (data.payment_split.length > 0) {
      printer.newLine();
      printer.println('Payment Breakdown');
      for (const p of data.payment_split) {
        printer.leftRight(`  ${methodLabel(p.method)} (${p.count})`, formatCurrency(p.amount));
      }
    }

    // ─── FOOTER ─────────────────────────────────────────────────────
    printer.newLine();
    printer.alignCenter();
    printer.println(data.receiptHeader || 'Thank you for shopping with us!');
    if (data.receiptFooter) {
      printer.println(data.receiptFooter);
    }
    printer.newLine();
    printer.drawLine('-');
    printer.alignCenter();
    printer.println('Developed by Abdul Rauf | 03336982272');

    // ─── CUT ────────────────────────────────────────────────────────
    printer.newLine();
    printer.cut();

    const buffer = printer.getBuffer();
    await sendToPrinter(buffer);
    return { success: true };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error('[Printer] Consolidated print failed:', msg);
    console.log('=== CONSOLIDATED RETAIL RECEIPT ===');
    console.log(buildTextConsolidatedReceipt(data));
    console.log('===================================');
    return { success: false, error: msg };
  }
}

function buildTextConsolidatedReceipt(data: ConsolidatedReceiptData): string {
  const W = 48;
  const sep = '-'.repeat(W);
  const dsep = '='.repeat(W);
  const lines: string[] = [];
  const pad = (s: string, len: number) => s.padEnd(len);
  const lr = (l: string, r: string) => pad(l, W - r.length) + r;
  const center = (s: string) => s.padStart(Math.floor((W + s.length) / 2)).padEnd(W);

  lines.push(center(data.businessName || 'Sheikh Ahmad Mobiles'));
  const contactParts: string[] = [];
  if (data.businessPhone) contactParts.push(data.businessPhone);
  if (data.businessAddress) contactParts.push(data.businessAddress);
  if (contactParts.length > 0) lines.push(center(contactParts.join(' | ')));
  if (data.businessNTN) lines.push(center(`NTN: ${data.businessNTN}`));
  lines.push('');
  lines.push(center('~ RETAIL SALES RECEIPT ~'));
  lines.push(center(`Period: ${data.dateFrom}${data.dateTo && data.dateTo !== data.dateFrom ? ` - ${data.dateTo}` : ''}`));
  lines.push('');
  lines.push(sep);

  for (const p of data.products) {
    lines.push(lr(`${p.qty} x ${p.name}`, formatCurrency(p.amount)));
  }
  lines.push(sep);
  lines.push(lr('Retail Sales:', String(data.summary.sales_count)));
  lines.push(lr('Subtotal:', formatCurrency(data.summary.subtotal)));
  if (data.summary.discount_amount > 0) {
    lines.push(lr('Discount:', `-${formatCurrency(data.summary.discount_amount)}`));
  }
  lines.push(dsep);
  lines.push(lr('TOTAL:', formatCurrency(data.summary.total)));
  lines.push(dsep);

  if (data.payment_split.length > 0) {
    lines.push('');
    lines.push('Payment Breakdown');
    for (const p of data.payment_split) {
      lines.push(lr(`  ${methodLabel(p.method)} (${p.count})`, formatCurrency(p.amount)));
    }
  }

  lines.push('');
  lines.push(center(data.receiptHeader || 'Thank you for shopping with us!'));
  if (data.receiptFooter) lines.push(center(data.receiptFooter));

  return lines.join('\n');
}

// ─── TEXT FALLBACK (console / testing without printer) ──────────────
function buildTextReceipt(data: ReceiptData): string {
  const W = 48;
  const sep = '-'.repeat(W);
  const dsep = '='.repeat(W);
  const lines: string[] = [];
  const pad = (s: string, len: number) => s.padEnd(len);
  const rpad = (s: string, len: number) => s.padStart(len);
  const center = (s: string) => s.padStart(Math.floor((W + s.length) / 2)).padEnd(W);
  const lr = (l: string, r: string) => pad(l, W - r.length) + r;

  lines.push(center(data.businessName || 'Sheikh Ahmad Mobiles'));
  const contactParts: string[] = [];
  if (data.businessPhone) contactParts.push(data.businessPhone);
  if (data.businessAddress) contactParts.push(data.businessAddress);
  if (contactParts.length > 0) lines.push(center(contactParts.join(' | ')));
  if (data.businessNTN) lines.push(center(`NTN: ${data.businessNTN}`));
  lines.push('');
  lines.push(center('~ Invoice ~'));
  lines.push('');
  lines.push(sep);
  lines.push(lr(`Order: #${data.orderId}`, `Bill: #${data.billId}`));
  lines.push(`Date:   ${data.timestamp}`);
  lines.push(`Cashier: ${data.cashierName}`);
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  const saleTypeLabel = data.saleType === 'wholesale' ? 'Wholesale' : 'Retail';
  lines.push(`Sale: ${saleTypeLabel}`);
  lines.push(sep);

  for (const item of data.items) {
    const itemTotal = item.price * item.qty - (item.discount || 0);
    lines.push(lr(`${item.qty}x ${item.name}`, formatCurrency(itemTotal)));
    if (item.discount && item.discount > 0) {
      lines.push(lr('  Discount:', `-${formatCurrency(item.discount)}`));
    }
  }
  lines.push(sep);
  lines.push(lr('Subtotal:', formatCurrency(data.subtotal)));
  if (data.discountAmount > 0) {
    lines.push(lr('Discount:', `-${formatCurrency(data.discountAmount)}`));
  }
  lines.push(dsep);
  lines.push(lr('TOTAL:', formatCurrency(data.total)));
  lines.push(dsep);
  lines.push('');
  const methodLabel = data.paymentMethod === 'cash' ? 'CASH' : data.paymentMethod === 'card' ? 'CARD' : data.paymentMethod === 'jazzcash' ? 'JAZZCASH' : data.paymentMethod === 'easypaisa' ? 'EASYPAISA' : data.paymentMethod === 'bank_transfer' ? 'BANK TRANSFER' : 'CREDIT';
  lines.push(lr('Payment:', methodLabel));
  lines.push('');
  lines.push(center(data.receiptHeader || 'Thank you for shopping with us!'));
  if (data.receiptFooter) lines.push(center(data.receiptFooter));

  return lines.join('\n');
}

// ─── IPC HANDLERS ───────────────────────────────────────────────────
export function registerPrinterHandlers() {
  // Test printer connection via Windows Spooler
  ipcMain.handle('printer:test', async () => {
    try {
      return await checkPrinterConnection();
    } catch (err: any) {
      return { success: false, connected: false, error: err.message || 'Printer not available' };
    }
  });

  // Print receipt
  ipcMain.handle('printer:print-receipt', async (_event, data: ReceiptData) => {
    return printReceipt(data);
  });

  // Print consolidated retail receipts for a date range (day close)
  ipcMain.handle('printer:print-consolidated-receipts', async (_event, data: ConsolidatedReceiptData) => {
    return printConsolidatedReceipts(data);
  });

  // Test print — sends a sample receipt
  ipcMain.handle('printer:test-print', async () => {
    const testReceipt: ReceiptData = {
      orderId: 0,
      billId: 0,
      items: [
        { name: 'Samsung Galaxy A05', qty: 2, price: 28500 },
        { name: 'Type-C Charger', qty: 3, price: 500 },
        { name: 'Tempered Glass', qty: 1, price: 250 },
      ],
      subtotal: 58750,
      discountAmount: 0,
      total: 58750,
      paymentMethod: 'cash',
      cashierName: 'Test',
      saleType: 'retail',
      timestamp: new Date().toLocaleString(),
      businessName: 'Sheikh Ahmad Mobiles',
      businessPhone: '0300-1234567',
      businessAddress: 'Main Bazaar',
      businessNTN: '12345-6789012-3',
      receiptHeader: 'Thank you for shopping with us!',
      receiptFooter: 'Powered by Sheikh Ahmed Mobile POS',
    };
    return printReceipt(testReceipt);
  });

  // List available Windows printers
  ipcMain.handle('printer:list-windows', async () => {
    try {
      const printer = await import('@maxxuxx/node-printer');
      const printers = await printer.listPrinters('winspool');
      return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
    } catch (err: any) {
      return [];
    }
  });
}
