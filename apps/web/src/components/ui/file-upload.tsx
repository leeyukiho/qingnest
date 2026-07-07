import { useRef, useState, type MouseEvent } from "react";
import { FileArchive, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  accept?: string;
  disabled?: boolean;
  files?: File[];
  multiple?: boolean;
  onChange: (files: File[]) => void;
};

export function FileUpload({
  accept = ".zip,application/zip,application/x-zip-compressed",
  disabled = false,
  files = [],
  multiple = false,
  onChange
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const selectedFile = files[0] ?? null;

  function emitFiles(fileList: FileList | null) {
    if (!fileList || disabled) return;

    const nextFiles = Array.from(fileList);
    onChange(multiple ? nextFiles : nextFiles.slice(0, 1));
  }

  function clearFiles(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (inputRef.current) inputRef.current.value = "";
    onChange([]);
  }

  return (
    <div
      className={cn(
        "group relative mx-auto flex min-h-64 w-full max-w-4xl cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed p-6 text-center transition-colors",
        dragging
          ? "border-cyan-300 bg-cyan-300/10"
          : "border-neutral-700 bg-black/35 hover:border-cyan-300/70 hover:bg-white/[0.04]",
        disabled && "pointer-events-none opacity-60"
      )}
      onClick={() => inputRef.current?.click()}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        emitFiles(event.dataTransfer.files);
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        accept={accept}
        className="sr-only"
        disabled={disabled}
        multiple={multiple}
        onChange={(event) => {
          emitFiles(event.target.files);
          event.currentTarget.value = "";
        }}
        type="file"
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.13),transparent_42%)] opacity-80" />
      <div className="relative z-10 flex flex-col items-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-cyan-100 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          {selectedFile ? <FileArchive className="h-6 w-6" /> : <UploadCloud className="h-6 w-6" />}
        </span>
        <p className="mt-5 text-base font-semibold text-white">
          {selectedFile ? selectedFile.name : "点击或拖拽 ZIP 到这里"}
        </p>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
          {selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : "上传包含入口 HTML 的静态站点压缩包。"}
        </p>
        {selectedFile ? (
          <button
            className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
            onClick={clearFiles}
            type="button"
          >
            <X className="h-4 w-4" />
            重新选择
          </button>
        ) : null}
      </div>
    </div>
  );
}
