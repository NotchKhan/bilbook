"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, LoaderCircle, ImagePlus, School } from "lucide-react";
export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть"
          onClick={close}
          disabled={busy}
        >
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Busy() {
  return (
    <span className="loading" role="status">
      <LoaderCircle size={19} className="spin" />
      Загрузка…
    </span>
  );
}
export function Avatar({
  name = "",
  id,
  size = "",
}: {
  name?: string;
  id?: string | null;
  size?: string;
}) {
  return (
    <span className={"avatar " + size}>
      {id ? (
        <img src={"/api/media/" + id} alt="" />
      ) : (
        name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("") || "Б"
      )}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-symbol">
        <School size={25} strokeWidth={1.6} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function FileField({
  file,
  setFile,
  required = false,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  required?: boolean;
}) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div className="file-field">
      <label className="file-label">
        <ImagePlus size={25} />
        <span>
          {file ? file.name : "Добавить фотографию"}
          <small>
            JPEG, PNG, WebP · до 8 МБ{required ? " · обязательно" : ""}
          </small>
        </span>
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required={required && !file}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && f.size > 8 * 1024 * 1024) {
              e.target.setCustomValidity("Фото должно быть меньше 8 МБ");
              e.target.reportValidity();
              return;
            }
            e.target.setCustomValidity("");
            setFile(f || null);
            e.target.value = "";
          }}
        />
      </label>
      {file && (
        <>
          <img
            ref={preview}
            alt="Предпросмотр выбранного фото"
            className="upload-preview"
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setFile(null)}
          >
            Убрать фото
          </button>
        </>
      )}
    </div>
  );
}
export const date = (value: string) =>
  new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
