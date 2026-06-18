'use client';

import dynamic from 'next/dynamic';

// pdfjs + canvas work is client-only.
const PdfReader = dynamic(() => import('@/components/PdfReader'), { ssr: false });

export default function Home() {
  return (
    <main className="min-h-screen">
      <PdfReader />
    </main>
  );
}
