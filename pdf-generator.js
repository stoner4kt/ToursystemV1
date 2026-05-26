// ============================================================
//  TRANSROUTE PWA — PDF GENERATION LOGIC (INYATHI EDITION)
// ============================================================

async function generateInspectionPDF(data, profile) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  // Create a new PDF Document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 Size
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── 1. HEADER & BRANDING ──────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: rgb(0.06, 0.15, 0.27), // Navy Blue
  });

  page.drawText('VEHICLE INSPECTION REPORT', {
    x: 40,
    y: height - 45,
    size: 20,
    font: boldFont,
    color: rgb(1, 1, 1),
  });

  page.drawText(`Reference: ${data.vehicle_reg}-${new Date().getTime().toString().slice(-6)}`, {
    x: 40,
    y: height - 65,
    size: 10,
    font,
    color: rgb(0.96, 0.62, 0.04), // Amber
  });

  // ── 2. METADATA SECTION ────────────────────────────────────
  let yPos = height - 120;

  const drawField = (label, value, x) => {
    page.drawText(`${label}:`, { x, y: yPos, size: 10, font: boldFont });
    page.drawText(String(value || 'N/A'), { x: x + 80, y: yPos, size: 10, font });
  };

  drawField('Vehicle Reg', data.vehicle_reg, 40);
  drawField('Inspection', data.inspection_type.toUpperCase(), 300);
  yPos -= 20;
  drawField('Driver', profile.name, 40);
  drawField('Mileage', `${data.mileage_at_inspection} km`, 300);
  yPos -= 20;
  drawField('Date', new Date(data.submitted_at).toLocaleString(), 40);

  yPos -= 40;

  // ── 3. CHECKLIST RESULTS ───────────────────────────────────
  page.drawText('SAFETY CHECKLIST SUMMARY', { x: 40, y: yPos, size: 12, font: boldFont });
  yPos -= 15;
  page.drawLine({
    start: { x: 40, y: yPos },
    end: { x: 550, y: yPos },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  });
  yPos -= 20;

  const items = Object.entries(data.checklist_json);
  let col1Y = yPos;
  
  // Split items into two columns for the PDF
  items.forEach(([item, status], index) => {
    const x = index % 2 === 0 ? 40 : 300;
    const currentY = index % 2 === 0 ? col1Y : col1Y;

    const statusColor = status === 'ok' ? rgb(0, 0.5, 0) : rgb(0.8, 0, 0);
    page.drawText(`• ${item}:`, { x, y: currentY, size: 9, font });
    page.drawText(status.toUpperCase(), { x: x + 150, y: currentY, size: 9, font: boldFont, color: statusColor });

    if (index % 2 !== 0) col1Y -= 15;
    
    // Check if we need a new page (simple version)
    if (col1Y < 250) {
        yPos = col1Y; 
    }
  });

  yPos = col1Y - 40;

  // ── 4. FAULTS & NOTES ──────────────────────────────────────
  if (data.faults_json && data.faults_json.length > 0) {
    page.drawText('REPORTED FAULTS:', { x: 40, y: yPos, size: 10, font: boldFont, color: rgb(0.8, 0, 0) });
    yPos -= 15;
    page.drawText(data.faults_json.join(', '), { x: 40, y: yPos, size: 9, font, maxWidth: 500 });
    yPos -= 30;
  }

  if (data.notes) {
    page.drawText('ADDITIONAL NOTES:', { x: 40, y: yPos, size: 10, font: boldFont });
    yPos -= 15;
    page.drawText(data.notes, { x: 40, y: yPos, size: 9, font, maxWidth: 500 });
    yPos -= 40;
  }

  // ── 5. DUAL SIGNATURES ─────────────────────────────────────
  // Move to bottom of page if space is tight
  if (yPos < 200) { yPos = 200; }

  const embedSignature = async (base64, x, label) => {
    try {
      const sigImage = await pdfDoc.embedPng(base64);
      const dims = sigImage.scale(0.25);
      page.drawImage(sigImage, {
        x: x,
        y: yPos - 60,
        width: dims.width,
        height: dims.height,
      });
      page.drawLine({
        start: { x: x, y: yPos - 65 },
        end: { x: x + 150, y: yPos - 65 },
        thickness: 1,
      });
      page.drawText(label, { x: x, y: yPos - 80, size: 10, font: boldFont });
    } catch (e) {
      console.error("Signature embed error:", e);
    }
  };

  await embedSignature(data.driver_signature, 40, "Driver Signature");
  await embedSignature(data.client_signature, 300, "Client/Manager Signature");

  // ── 6. FINALIZING ──────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// Helper to trigger download
function downloadPDF(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// ── TRANSFER RECON PDF ────────────────────────────────────────
async function generateTransferReconPDF(sheetData) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc  = await PDFDocument.create();
  const page    = pdfDoc.addPage([841.89, 595.28]); // A4 Landscape
  const { width, height } = page.getSize();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const navyColor  = rgb(0.06, 0.15, 0.27);
  const amberColor = rgb(0.96, 0.62, 0.04);
  const whiteColor = rgb(1, 1, 1);
  const darkColor  = rgb(0.12, 0.16, 0.23);
  const grayColor  = rgb(0.47, 0.47, 0.47);

  // Header
  page.drawRectangle({ x: 0, y: height - 50, width, height: 50, color: navyColor });
  page.drawText('INYATHI', { x: 20, y: height - 22, size: 18, font: boldFont, color: whiteColor });
  page.drawText((sheetData.company || 'INYATHI (Pty) Ltd'), { x: 20, y: height - 36, size: 8, font, color: amberColor });
  page.drawText('TRANSFER RECON FOR WEEKLY PAYMENT', {
    x: width / 2 - 140, y: height - 28, size: 14, font: boldFont, color: whiteColor,
  });

  let yPos = height - 68;

  // Driver + week meta
  page.drawText('Driver Name:', { x: 20, y: yPos, size: 9, font: boldFont, color: darkColor });
  page.drawText(sheetData.driverName || '—', { x: 90, y: yPos, size: 9, font, color: darkColor });
  page.drawText('Week:', { x: width / 2, y: yPos, size: 9, font: boldFont, color: darkColor });
  page.drawText(`${sheetData.weekStart || ''} to ${sheetData.weekEnd || ''}`, { x: width / 2 + 28, y: yPos, size: 9, font, color: darkColor });
  yPos -= 14;

  // Instruction notice
  const notice = 'All transfer information to be added here. Client reference numbers to be added to every date. NO salary will be paid if this form has not been completed and sent to the office by every Thursday. Payments will be done once form has been received and checked. NO immediate payments will be made.';
  const noticeWords = notice.split(' ');
  let line = ''; const noteLines = [];
  noticeWords.forEach((w) => {
    const test = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(test, 7.5) < width - 40) { line = test; }
    else { noteLines.push(line); line = w; }
  });
  if (line) noteLines.push(line);
  page.drawText(noteLines.join('\n'), { x: 20, y: yPos, size: 7.5, font, color: grayColor, lineHeight: 11 });
  yPos -= noteLines.length * 11 + 8;

  // Table header
  const colDefs = [
    { label: '#',                     w: 18  },
    { label: 'Vehicle Reg',           w: 60  },
    { label: 'Vehicle Name',          w: 65  },
    { label: 'Transfer Date',         w: 62  },
    { label: 'Tour/Transfer Ref Nr',  w: 100 },
    { label: 'T/L/A Type',            w: 80  },
    { label: 'Description',           w: 110 },
    { label: 'Notes',                 w: 80  },
  ];
  const tableLeft = 20;
  let colX = tableLeft;
  const colXArr = colDefs.map((c) => { const x = colX; colX += c.w; return x; });

  page.drawRectangle({ x: tableLeft, y: yPos - 4, width: colX - tableLeft, height: 14, color: navyColor });
  colDefs.forEach((c, i) => {
    page.drawText(c.label, { x: colXArr[i] + 2, y: yPos, size: 7.5, font: boldFont, color: whiteColor });
  });
  yPos -= 16;

  // Table rows
  const transfers = Array.isArray(sheetData.transfers) ? sheetData.transfers : [];
  transfers.forEach((t, idx) => {
    if (yPos < 30) return;
    if (idx % 2 === 0) {
      page.drawRectangle({ x: tableLeft, y: yPos - 4, width: colX - tableLeft, height: 12, color: rgb(0.97, 0.98, 0.99) });
    }
    const cells = [
      String(idx + 1),
      t.vehicle_reg  || '—',
      t.vehicle_name || '—',
      t.transfer_date || '—',
      t.reference_nr || '—',
      t.tla_type     || '—',
      t.description  || '—',
      t.notes        || '—',
    ];
    colDefs.forEach((c, i) => {
      const cellText = String(cells[i]);
      const maxW = c.w - 4;
      let display = cellText;
      while (display.length > 1 && font.widthOfTextAtSize(display, 8) > maxW) display = display.slice(0, -1);
      page.drawText(display, { x: colXArr[i] + 2, y: yPos, size: 8, font: i === 4 ? boldFont : font, color: darkColor });
    });
    page.drawLine({ start: { x: tableLeft, y: yPos - 5 }, end: { x: colX, y: yPos - 5 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    yPos -= 13;
  });

  if (!transfers.length) {
    page.drawText('No transfers recorded.', { x: width / 2 - 50, y: yPos, size: 9, font, color: grayColor });
    yPos -= 14;
  }

  // Footer
  yPos -= 8;
  page.drawText(`Total Transfers: ${transfers.length}`, { x: 20, y: yPos, size: 8, font: boldFont, color: darkColor });
  page.drawText(`Generated: ${new Date().toLocaleString('en-ZA')}`, { x: width - 160, y: yPos, size: 7.5, font, color: grayColor });

  return pdfDoc.save();
}