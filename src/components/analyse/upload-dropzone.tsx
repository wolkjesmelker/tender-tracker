'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACCEPTED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.json', '.docx', '.doc'];

interface UploadFile {
  file: File;
  id: string;
}

interface Props {
  onUploaded: (sessieId: string, naam: string) => void;
}

export function UploadDropzone({ onUploaded }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const newFiles = Array.from(incoming)
      .filter((f) => ACCEPTED_TYPES.includes(f.type) || ACCEPTED_EXTENSIONS.some((ext) => f.name.endsWith(ext)))
      .map((f) => ({ file: f, id: `${f.name}-${Date.now()}` }));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.file.name));
      return [...prev, ...newFiles.filter((f) => !existing.has(f.file.name))];
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f.file));

    try {
      const res = await fetch('/api/analyse/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Upload mislukt');
        return;
      }

      setFiles([]);
      onUploaded(data.sessie_id, data.naam);
    } catch {
      setError('Verbindingsfout — probeer opnieuw');
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-all',
          dragOver
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <div className={cn('rounded-full p-4 transition-colors', dragOver ? 'bg-primary/10' : 'bg-background')}>
          <Upload className={cn('size-8 transition-colors', dragOver ? 'text-primary' : 'text-muted-foreground')} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {dragOver ? 'Loslaten om toe te voegen' : 'Sleep bestanden hierheen'}
          </p>
          <p className="text-xs text-muted-foreground">
            of klik om te selecteren · PDF, TXT, DOCX, MD, JSON · max 50 MB
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(({ file, id }) => (
            <div key={id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <FileText className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(id); }}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <Button onClick={handleUpload} disabled={uploading} className="w-full">
            {uploading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Uploaden en naam extraheren…
              </>
            ) : (
              <>
                <Upload className="mr-2 size-4" />
                {files.length === 1 ? '1 bestand uploaden' : `${files.length} bestanden uploaden`}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
