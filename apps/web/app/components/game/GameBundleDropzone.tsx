import { useState, type DragEvent, type ReactNode } from "react";
import { Loader2, UploadCloud } from "lucide-react";

interface GameBundleDropzoneProps {
  busy: boolean;
  title: ReactNode;
  onFile: (file: File) => void | Promise<void>;
  onFiles?: ((files: readonly File[]) => void | Promise<void>) | undefined;
  multiple?: boolean | undefined;
  actionLabel?: string;
}

/** Shared ZIP entry point for Game Creator and trusted-admin publication.
 *
 * Keeping selection and drag-and-drop behavior in one component prevents the two upload surfaces
 * from drifting. Publisher authority deliberately stays outside this component and is selected by
 * the server route that receives the bundle.
 */
export function GameBundleDropzone({
  busy,
  title,
  onFile,
  onFiles,
  multiple = false,
  actionLabel = "또는 파일 선택",
}: GameBundleDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const submit = (files: FileList | readonly File[]) => {
    if (busy) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;
    if (multiple && onFiles) {
      void onFiles(selected);
      return;
    }
    const first = selected[0];
    if (first) void onFile(first);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    submit(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        dragActive ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand-light"
      }`}
    >
      {busy ? (
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      ) : (
        <UploadCloud className="h-6 w-6 text-text-muted" />
      )}
      <p className="text-xs font-bold text-text-primary">{title}</p>
      <label className="cursor-pointer text-[11px] font-semibold text-brand hover:text-brand-light">
        {actionLabel}
        <input
          type="file"
          accept=".zip,application/zip"
          multiple={multiple}
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const files = event.target.files;
            event.target.value = "";
            if (files) submit(files);
          }}
        />
      </label>
    </div>
  );
}
