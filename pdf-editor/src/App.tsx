import { Eraser, FileText, Layers, Lock, PenLine, Shapes, Sparkles, Upload } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import { useState } from 'react';
import { Editor } from './editor/Editor';
import type { LoadedDoc } from './editor/context';
import { createSamplePdf } from './lib/samplePdf';
import { loadPdfJs } from './pdf/pdfjs';
import type { DocState } from './state/types';

async function openPdf(name: string, bytes: Uint8Array): Promise<{ doc: LoadedDoc; initial: DocState }> {
  const pdf = await loadPdfJs(bytes);
  const lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages: DocState['pages'] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const p = await pdf.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    pages.push({
      id: `page-${i}`,
      srcIndex: i,
      rotation: 0,
      width: vp.width,
      height: vp.height,
      objects: [],
    });
  }
  return { doc: { name, bytes, pdf, lib, encrypted: lib.isEncrypted }, initial: { pages } };
}

export default function App() {
  const [loaded, setLoaded] = useState<{ doc: LoadedDoc; initial: DocState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const load = async (name: string, getBytes: () => Promise<Uint8Array>) => {
    setError(null);
    setLoading(true);
    try {
      const bytes = await getBytes();
      setLoaded(await openPdf(name, bytes));
    } catch (err) {
      console.error(err);
      const msg = (err as Error)?.message ?? String(err);
      setError(/password/i.test(msg) ? 'This PDF is password protected and cannot be opened.' : `Could not open this file: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.');
      return;
    }
    load(file.name, async () => new Uint8Array(await file.arrayBuffer()));
  };

  if (loaded) {
    return (
      <Editor
        key={loaded.doc.name + loaded.doc.bytes.length}
        doc={loaded.doc}
        initial={loaded.initial}
        onClose={() => {
          loaded.doc.pdf.loadingTask.destroy();
          setLoaded(null);
        }}
      />
    );
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="brand">
          <div className="logo">P</div>
          <strong>PDF Editor</strong>
        </div>
        <span className="pill">
          <Lock size={14} /> 100% in your browser · free
        </span>
      </header>
      <main className="landing-main">
        <h1>Edit any PDF, right in your browser.</h1>
        <p className="lead">
          Change existing text, erase content, add text, images and shapes, and reorganize pages. Your file never leaves
          your device.
        </p>
        <label
          className={`dropzone${dragging ? ' dragging' : ''}`}
          data-testid="dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            data-testid="file-input"
            onChange={(e) => onFile(e.target.files?.[0])}
            hidden
          />
          <div className="drop-icon">{loading ? <span className="spinner" /> : <Upload size={28} />}</div>
          <strong>{loading ? 'Opening…' : 'Drop a PDF here or click to choose'}</strong>
          <span className="muted small">Files are processed locally — nothing is uploaded.</span>
        </label>
        <button
          className="btn btn-ghost sample-btn"
          data-testid="sample"
          disabled={loading}
          onClick={() => load('sample.pdf', createSamplePdf)}
        >
          <Sparkles size={16} /> Try it with a sample PDF
        </button>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <ul className="features">
          <li>
            <PenLine size={20} />
            <div>
              <strong>Edit text in place</strong>
              <span>Change wording, font, size, color, bold and italic.</span>
            </div>
          </li>
          <li>
            <Eraser size={20} />
            <div>
              <strong>Erase & remove</strong>
              <span>Whiteout regions, delete text and embedded images.</span>
            </div>
          </li>
          <li>
            <Shapes size={20} />
            <div>
              <strong>Add content</strong>
              <span>New text boxes, images, rectangles, ellipses and lines.</span>
            </div>
          </li>
          <li>
            <Layers size={20} />
            <div>
              <strong>Organize pages</strong>
              <span>Reorder, rotate, delete or add blank pages.</span>
            </div>
          </li>
          <li>
            <FileText size={20} />
            <div>
              <strong>Real PDF output</strong>
              <span>Edited text is removed from the page content, not just hidden.</span>
            </div>
          </li>
        </ul>
      </main>
    </div>
  );
}
