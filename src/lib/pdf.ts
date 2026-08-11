/** Shared client-side PDF reporting used by scanners, radar, liquidity and backtest. */
import { jsPDF } from "jspdf";

export type PdfTable = { headers: string[]; rows: (string | number)[][] };
export type PdfSection = { heading: string; lines?: string[]; table?: PdfTable };

const MARGIN = 40;
const LINE = 13;

export function downloadReportPdf(opts: {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  fileName: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = MARGIN;

  const newPageIfNeeded = (needed = LINE) => {
    if (y + needed > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("CoTraders", MARGIN, y);
  doc.setFontSize(13);
  y += 20;
  doc.text(opts.title, MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  y += 14;
  doc.setTextColor(110);
  doc.text(opts.subtitle ?? "", MARGIN, y);
  y += 12;
  doc.text(`Generated ${new Date().toLocaleString()} · made by kaif · @abdul_kaif12`, MARGIN, y);
  doc.setTextColor(0);
  y += 18;
  doc.setDrawColor(200);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 18;

  opts.sections.forEach((section) => {
    newPageIfNeeded(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.heading, MARGIN, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    (section.lines ?? []).forEach((line) => {
      const wrapped = doc.splitTextToSize(line, pageW - MARGIN * 2) as string[];
      wrapped.forEach((row) => {
        newPageIfNeeded();
        doc.text(row, MARGIN, y);
        y += LINE;
      });
    });

    if (section.table && section.table.rows.length) {
      const cols = section.table.headers.length;
      const colW = (pageW - MARGIN * 2) / cols;
      const drawRow = (cells: (string | number)[], bold: boolean) => {
        newPageIfNeeded(LINE + 4);
        doc.setFont("helvetica", bold ? "bold" : "normal");
        cells.forEach((cell, index) => {
          const text = doc.splitTextToSize(String(cell ?? ""), colW - 6)[0] as string;
          doc.text(text ?? "", MARGIN + index * colW, y);
        });
        y += LINE;
      };
      y += 4;
      drawRow(section.table.headers, true);
      doc.setDrawColor(220);
      doc.line(MARGIN, y - 9, pageW - MARGIN, y - 9);
      section.table.rows.forEach((row) => drawRow(row, false));
      doc.setFont("helvetica", "normal");
    }

    y += 14;
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`CoTraders · page ${p}/${pages}`, pageW - MARGIN, pageH - 20, { align: "right" });
    doc.setTextColor(0);
  }

  doc.save(opts.fileName.endsWith(".pdf") ? opts.fileName : `${opts.fileName}.pdf`);
}

export const pdfNum = (n: number, digits = 4) =>
  Number.isFinite(n) ? n.toFixed(Math.abs(n) >= 1000 ? 2 : digits) : "—";
