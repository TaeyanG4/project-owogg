import { useState, type DragEvent, type ReactNode } from "react";
import { Loader2, UploadCloud } from "lucide-react";

interface GameBundleDropzoneProps {
  busy: boolean;
  title: ReactNode;
  onFile: (file: File) => void | Promise<void>;
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
  actionLabel = "또는 파일 선택",
}: GameBundleDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const submit = (file: File | undefined) => {
    if (!file || busy) return;
    void onFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    submit(event.dataTransfer.files[0]);
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
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            submit(file);
          }}
        />
      </label>
    </div>
  );
}
