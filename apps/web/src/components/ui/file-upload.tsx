import { useRef, useState, type DragEvent, type InputHTMLAttributes, type MouseEvent } from "react";
import { FileArchive, FolderUp, Loader2, UploadCloud, X } from "lucide-react";
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

type BrowserFileHandle = {
  getFile: () => Promise<File>;
  kind: "file";
  name: string;
};

type BrowserDirectoryHandle = {
  entries: () => AsyncIterable<[string, BrowserFileHandle | BrowserDirectoryHandle]>;
  kind: "directory";
  name: string;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<BrowserDirectoryHandle>;
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
    value: path.replace(/\\/g, "/").replace(/^\/+/, "")
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

async function collectDirectoryHandleFiles(directory: BrowserDirectoryHandle, prefix = directory.name): Promise<File[]> {
  const files: File[] = [];

  for await (const [, handle] of directory.entries()) {
    const path = `${prefix}/${handle.name}`;

    if (handle.kind === "file") {
      files.push(withRelativePath(await handle.getFile(), path));
    } else {
      files.push(...(await collectDirectoryHandleFiles(handle, path)));
    }
  }

  return files;
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
  const [collecting, setCollecting] = useState(false);
  const inactive = disabled || collecting;
  const selectedFile = files[0] ?? null;
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  const hasMultipleFiles = files.length > 1;
  const directoryInputProps: DirectoryInputProps = allowDirectories ? { directory: "", webkitdirectory: "" } : {};

  function emitFiles(fileList: FileList | File[] | null) {
    if (!fileList || inactive) return;

    const nextFiles = Array.from(fileList);
    onChange(multiple || allowDirectories ? nextFiles : nextFiles.slice(0, 1));
  }

  function clearFiles(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (directoryInputRef.current) directoryInputRef.current.value = "";
    onChange([]);
  }

  async function chooseDirectory(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (inactive) return;

    const showDirectoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;

    if (showDirectoryPicker) {
      try {
        setCollecting(true);
        onChange(await collectDirectoryHandleFiles(await showDirectoryPicker({ mode: "read" })));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        setCollecting(false);
      }

      return;
    }

    directoryInputRef.current?.click();
  }

  return (
    <div
      className={cn(
        "group relative mx-auto flex min-h-64 w-full max-w-4xl flex-col items-center justify-center overflow-hidden rounded-md border border-dashed bg-black p-6 text-center transition-colors",
        dragging
          ? "border-white bg-white/[0.03]"
          : "border-white/15 hover:border-white/40 hover:bg-white/[0.02]",
        inactive && "pointer-events-none opacity-60"
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inactive) setDragging(true);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        if (inactive) return;
        setCollecting(true);
        try {
          const droppedFiles = await getDroppedFiles(event);
          onChange(multiple || allowDirectories ? droppedFiles : droppedFiles.slice(0, 1));
        } finally {
          setCollecting(false);
        }
      }}
    >
      <input
        ref={fileInputRef}
        accept={accept}
        className="sr-only"
        disabled={inactive}
        multiple={multiple || allowDirectories}
        onChange={(event) => {
          setCollecting(true);
          try {
            emitFiles(event.target.files);
          } finally {
            setCollecting(false);
          }
          event.currentTarget.value = "";
        }}
        type="file"
      />
      {allowDirectories ? (
        <input
          ref={directoryInputRef}
          className="sr-only"
          disabled={inactive}
          multiple
          onChange={(event) => {
            setCollecting(true);
            try {
              emitFiles(event.target.files);
            } finally {
              setCollecting(false);
            }
            event.currentTarget.value = "";
          }}
          type="file"
          {...directoryInputProps}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />
      <div className="relative z-10 flex flex-col items-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-md border border-white/20 bg-black text-zinc-100">
          {collecting ? <Loader2 className="h-6 w-6 animate-spin" /> : selectedFile ? hasMultipleFiles ? <FolderUp className="h-6 w-6" /> : <FileArchive className="h-6 w-6" /> : <UploadCloud className="h-6 w-6" />}
        </span>
        <p className="mt-5 text-base font-semibold text-white">
          {collecting ? "正在读取文件" : selectedFile ? (hasMultipleFiles ? `已选择 ${files.length} 个文件` : selectedFile.name) : "点击或拖拽文件夹 / 文件到这里"}
        </p>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
          {collecting
            ? "请稍候，完成后会自动检查文件数量和大小"
            : selectedFile
            ? `${(totalSize / 1024 / 1024).toFixed(2)} MB`
            : "支持直接上传包含 index.html 的文件夹、多个文件、单个 HTML 文件，也兼容 ZIP。"}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-black px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              fileInputRef.current?.click();
            }}
            type="button"
          >
            <FileArchive className="h-4 w-4" />
            选择文件
          </button>
          {allowDirectories ? (
            <button
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-black px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
              onClick={chooseDirectory}
              type="button"
            >
              <FolderUp className="h-4 w-4" />
              选择文件夹
            </button>
          ) : null}
          {selectedFile ? (
            <button
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-white/10 bg-black px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
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
