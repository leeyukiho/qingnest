import { useRef, useState, type DragEvent, type InputHTMLAttributes, type MouseEvent } from "react";
import { FileArchive, FolderUp, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

type DirectoryInputProps = InputHTMLAttributes<HTMLInputElement> & {
  directory?: string;
  webkitdirectory?: string;
};

type DirectoryEntry = FileSystemDirectoryEntry & {
  createReader: () => { readEntries: (callback: (entries: FileSystemEntry[]) => void) => void };
};

type FileEntry = FileSystemFileEntry & {
  file: (callback: (file: File) => void) => void;
};

type FileUploadProps = {
  accept?: string;
  allowDirectories?: boolean;
  disabled?: boolean;
  files?: File[];
  multiple?: boolean;
  onChange: (files: File[]) => void;
};

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: path.replace(/^\/+/, "/").slice(1)
  });

  return file;
}

function readEntries(entry: DirectoryEntry) {
  return new Promise<FileSystemEntry[]>((resolve) => {
    const reader = entry.createReader();
    const entries: FileSystemEntry[] = [];

    function readNextBatch() {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }

        entries.push(...batch);
        readNextBatch();
      });
    }

    readNextBatch();
  });
}

async function collectEntryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileEntry).file((file) => resolve([withRelativePath(file, entry.fullPath)]));
    });
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readEntries(entry as DirectoryEntry);
  const nested = await Promise.all(children.map(collectEntryFiles));
  return nested.flat();
}

async function getDroppedFiles(event: DragEvent<HTMLDivElement>) {
  const entries = Array.from(event.dataTransfer.items)
    .map((item) => {
      const maybeEntryItem = item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null };
      return maybeEntryItem.webkitGetAsEntry?.() ?? null;
    })
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  if (entries.length > 0) {
    const files = await Promise.all(entries.map(collectEntryFiles));
    return files.flat();
  }

  return Array.from(event.dataTransfer.files);
}

export function FileUpload({
  accept,
  allowDirectories = false,
  disabled = false,
  files = [],
  multiple = false,
  onChange
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const selectedFile = files[0] ?? null;
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const hasMultipleFiles = files.length > 1;
  const directoryInputProps: DirectoryInputProps = allowDirectories ? { directory: "", webkitdirectory: "" } : {};

  function emitFiles(fileList: FileList | File[] | null) {
    if (!fileList || disabled) return;

    const nextFiles = Array.from(fileList);
    onChange(multiple || allowDirectories ? nextFiles : nextFiles.slice(0, 1));
  }

  function clearFiles(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (directoryInputRef.current) directoryInputRef.current.value = "";
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
      onClick={() => fileInputRef.current?.click()}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        emitFiles(await getDroppedFiles(event));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <input
        ref={fileInputRef}
        accept={accept}
        className="sr-only"
        disabled={disabled}
        multiple={multiple || allowDirectories}
        onChange={(event) => {
          emitFiles(event.target.files);
          event.currentTarget.value = "";
        }}
        type="file"
      />
      {allowDirectories ? (
        <input
          ref={directoryInputRef}
          className="sr-only"
          disabled={disabled}
          multiple
          onChange={(event) => {
            emitFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          type="file"
          {...directoryInputProps}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.13),transparent_42%)] opacity-80" />
      <div className="relative z-10 flex flex-col items-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-cyan-100 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
          {selectedFile ? hasMultipleFiles ? <FolderUp className="h-6 w-6" /> : <FileArchive className="h-6 w-6" /> : <UploadCloud className="h-6 w-6" />}
        </span>
        <p className="mt-5 text-base font-semibold text-white">
          {selectedFile ? (hasMultipleFiles ? `已选择 ${files.length} 个文件` : selectedFile.name) : "点击或拖拽文件夹 / 文件到这里"}
        </p>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
          {selectedFile
            ? `${(totalSize / 1024 / 1024).toFixed(2)} MB`
            : "支持直接上传包含 index.html 的文件夹、多个文件、单个 HTML 文件，也兼容 ZIP。"}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {allowDirectories ? (
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                directoryInputRef.current?.click();
              }}
              type="button"
            >
              <FolderUp className="h-4 w-4" />
              选择文件夹
            </button>
          ) : null}
          {selectedFile ? (
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
              onClick={clearFiles}
              type="button"
            >
              <X className="h-4 w-4" />
              重新选择
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
