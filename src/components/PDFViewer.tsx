'use client';

import { useState, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set worker source
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  file: File | null;
  pageNumber: number;
  onPageNumberChange: (page: number) => void;
  onPageChange: (pageNumber: number, currentText: string, nextText: string, additionalTexts?: Record<number, string>) => void;
  onDocumentReady: (numPages: number) => void;
  width?: number;
  batchSize?: number;
}

export default function PDFViewer({ file, pageNumber, onPageNumberChange, onPageChange, onDocumentReady, width = 480, batchSize = 5 }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const handleRenderError = useCallback((error: Error) => {
    // Ignore expected aborts triggered when quickly switching pages; surface others.
    if ((error as { name?: string })?.name === 'AbortException') return;
    console.warn('PDF render error', error);
  }, []);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    onDocumentReady(numPages);
    onPageNumberChange(1);
  }

  const extractTextFromPage = useCallback(async (pageNum: number) => {
    if (!pdfDocument || pageNum < 1 || pageNum > numPages) return '';

    try {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const textItems = textContent.items.map((item: any) => item.str);
      return textItems.join(' ');
    } catch (error) {
      console.error(`Error extracting text from page ${pageNum}:`, error);
      return '';
    }
  }, [pdfDocument, numPages]);

  useEffect(() => {
    const loadTexts = async () => {
      if (!pdfDocument) return;
      
      const currentText = await extractTextFromPage(pageNumber);
      const nextText = await extractTextFromPage(pageNumber + 1);
      
      // Extract additional pages for batch mode
      const additionalTexts: Record<number, string> = {};
      for (let offset = 2; offset < batchSize; offset++) {
        const p = pageNumber + offset;
        if (p > numPages) break;
        const text = await extractTextFromPage(p);
        if (text) additionalTexts[p] = text;
      }
      
      onPageChange(pageNumber, currentText, nextText, additionalTexts);
    };

    loadTexts();
  }, [pageNumber, extractTextFromPage, onPageChange, pdfDocument, batchSize, numPages]);

  function changePage(offset: number) {
    onPageNumberChange(Math.min(Math.max(1, pageNumber + offset), numPages || 1));
  }

  function previousPage() {
    changePage(-1);
  }

  function nextPage() {
    changePage(1);
  }

  return (
    <div className="flex flex-col items-center w-full">
      <div className="bg-[#fdf8f1] border border-[#e1d3c0] shadow-2xl rounded-[14px] p-3">
        <Document
          file={file}
          onLoadSuccess={(pdf) => {
            setPdfDocument(pdf);
            onDocumentLoadSuccess({ numPages: pdf.numPages });
          }}
          onLoadError={(error) => handleRenderError(error as Error)}
          className="max-w-full"
        >
          <Page 
            pageNumber={pageNumber} 
            width={width}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            onRenderError={handleRenderError}
          />
        </Document>
      </div>
    </div>
  );
}
