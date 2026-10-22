"use client";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, command } from "@/lib/client";
import { compressImage } from "@/lib/compress";
import type { Profile } from "@/lib/types";
import { categories } from "@/lib/types";
import { schoolClasses } from "@/lib/profile-fields";
import { EnrollmentFields } from "./welcome";
import { Modal, FileField } from "./ui";
export function AuthForm({
  close,
  done,
  configured,
  reset = false,
}: {
  close: () => void;
  done: () => void;
  configured: boolean;
  reset?: boolean;
}) {
  const [mode, setMode] = useState(reset ? "password" : "signin"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const data = await api<{ message?: string }>("auth", {
        action: mode,
        ...Object.fromEntries(form),
      });
      if (data.message) setMessage(data.message);
      else done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        mode === "signup"
          ? "Присоединиться к школе"
          : mode === "reset"
            ? "Восстановление пароля"
            : mode === "password"
              ? "Новый пароль"
              : "С возвращением"
      }
      close={close}
      busy={busy}
    >
      {!configured ? (
        <div className="notice">
          <ShieldCheck />
          <h3>Сначала подключим школу</h3>
          <p>
            Код авторизации готов, но Supabase ещё не подключён. Настройка базы
            и email описана в README проекта. До подключения школьные данные
            недоступны.
          </p>
          <button className="button" onClick={close}>
            Понятно
          </button>
        </div>
      ) : (
        <>
          <p className="muted">
            {mode === "signup"
              ? "Доступ только по приглашению вашей школы. После регистрации подтвердите email."
              : "Ваше школьное сообщество рядом."}
          </p>
          <form onSubmit={submit} className="form">
            <fieldset disabled={busy || Boolean(message)}>
              {mode === "signup" && <EnrollmentFields />}
              {mode !== "password" && (
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
              )}
              {mode !== "reset" && (
                <label>
                  Пароль
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    required
                    minLength={mode === "signin" ? 1 : 10}
                    maxLength={128}
                  />
                  {mode !== "signin" && <small>Не менее 10 символов</small>}
                </label>
              )}

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="button wide" disabled={busy}>
                {busy
                  ? "Подождите…"
                  : mode === "signup"
                    ? "Создать аккаунт"
                    : mode === "reset"
                      ? "Отправить ссылку"
                      : mode === "password"
                        ? "Сохранить пароль"
                        : "Войти"}
                <ArrowUpRight size={18} />
              </button>
            </fieldset>
          </form>
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
          <div className="form-links">
            {mode === "signin" ? (
              <>
                <button
                  className="text-button"
                  onClick={() => {
                    setMode("signup");
                    setError("");
                    setMessage("");
                  }}
                >
                  Есть приглашение
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setMode("reset");
                    setError("");
                    setMessage("");
                  }}
                >
                  Забыли пароль?
                </button>
              </>
            ) : (
              mode !== "password" && (
                <button
                  className="text-button"
                  onClick={() => {
                    setMode("signin");
                    setMessage("");
                    setError("");
                  }}
                >
                  Вернуться ко входу
                </button>
              )
            )}
          </div>
          <p className="fine">
            <LockKeyhole size={13} /> Материалы школы доступны после
            подтверждения email.
          </p>
        </>
      )}
    </Modal>
  );
}

export function Compose({
  kind,
  demo = false,
  profile,
  close,
  done,
}: {
  kind: "story" | "news" | "request" | "profile";
  demo?: boolean;
  profile: Profile;
  close: () => void;
  done: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confidential, setConfidential] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo) {
      setError(
        "Это просмотр формы. Для сохранения подключите школу и войдите в свой аккаунт.",
      );
      return;
    }
    setBusy(true);
    setError("");
    const fields = new FormData(e.currentTarget);
    let media_id: string | undefined;
    try {
      if (file) {
        const upload = new FormData();
        upload.set("file", await compressImage(file, kind === "profile" ? "avatar" : kind));
        upload.set("purpose", kind === "profile" ? "avatar" : kind);
        media_id = (await api<{ id: string }>("upload", upload)).id;
      }
      const payload: Record<string, unknown> = {
        ...Object.fromEntries(fields),
      };
      delete payload.file;
      if (kind === "story" && !media_id) throw Error("Добавьте фотографию.");
      if (kind === "profile")
        payload.dormitory = fields.get("dormitory") === "on";
      if (kind === "request") payload.confidential = confidential;
      if (media_id) payload.media_id = media_id;
      await command(kind, payload);
      done();
    } catch (e) {
      setError((e as Error).message);
      if (media_id) await api("discard", { id: media_id }).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    story: "Новая история",
    news: "Опубликовать новость",
    request: "Новое обращение",
    profile: "Редактировать профиль",
  };
  return (
    <Modal title={titles[kind]} close={close} busy={busy}>
      <form className="form" onSubmit={submit}>
        <fieldset disabled={busy}>
          {kind === "request" && (
            <>
              <div className="segmented">
                <button
                  type="button"
                  className={!confidential ? "selected" : ""}
                  aria-pressed={!confidential}
                  onClick={() => setConfidential(false)}
                >
                  Школьная проблема
                </button>
                <button
                  type="button"
                  className={confidential ? "selected" : ""}
                  aria-pressed={confidential}
                  onClick={() => setConfidential(true)}
                >
                  Личная ситуация
                </button>
              </div>
              <div
                className={"privacy-note " + (confidential ? "private" : "")}
              >
                <ShieldCheck size={21} />
                <p>
                  {confidential
                    ? "Увидите только вы и специально назначенные ответственные взрослые. Модераторы студсовета доступа не получат. Ответственные видят ваше имя — это не абсолютная анонимность."
                    : "Обращение сначала проверит модератор. После одобрения его увидит ваша школа. Имя скрыто от остальных учеников, но доступно модераторам и ответственным."}
                </p>
              </div>
            </>
          )}
          {kind === "profile" ? (
            <>
              <label>
                Имя и фамилия
                <input
                  name="name"
                  defaultValue={profile.name}
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
              <label>Класс<select name="class_name" defaultValue={(profile.class_name || "").replace(/\s/g, "")}><option value="">Не указан</option>{schoolClasses.map(c => <option key={c}>{c}</option>)}</select></label>
              <label>О себе<textarea name="bio" defaultValue={profile.bio || ""} maxLength={300} rows={3} placeholder="Интересы, увлечения, немного о себе" /><small>До 300 символов · видно участникам своей школы</small></label>
              <label className="check">
                <input
                  type="checkbox"
                  name="dormitory"
                  defaultChecked={profile.dormitory}
                />{" "}
                Живу в дормитории
              </label>
            </>
          ) : kind === "story" ? (
            <p className="muted">
              Один момент из школьной жизни. Фото исчезнет через 24 часа после
              публикации. До 5 историй за сутки.
            </p>
          ) : (
            <>
              <label>
                Заголовок
                <input
                  name="title"
                  required
                  minLength={3}
                  maxLength={140}
                  placeholder={
                    kind === "news"
                      ? "Чем поделимся со школой?"
                      : "Что произошло или что предлагаете?"
                  }
                />
              </label>
              <label>
                Категория
                <select
                  name="category"
                  defaultValue={
                    kind === "news"
                      ? "news"
                      : confidential
                        ? "personal"
                        : "dormitory"
                  }
                  key={String(confidential)}
                >
                  {(kind === "news"
                    ? ["news", "achievement", "event", "dormitory"]
                    : confidential
                      ? ["personal"]
                      : ["dormitory", "canteen", "facilities", "idea"]
                  ).map((c) => (
                    <option value={c} key={c}>
                      {categories[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {kind === "news" ? "Текст публикации" : "Описание"}
                <textarea
                  name="body"
                  required
                  minLength={3}
                  maxLength={kind === "news" ? 10000 : 6000}
                  rows={5}
                  placeholder={
                    kind === "request" && !confidential
                      ? "Не указывайте имена и личные обвинения. Для личных ситуаций выберите конфиденциальное обращение."
                      : "Расскажите подробнее…"
                  }
                />
              </label>
            </>
          )}
          <FileField
            file={file}
            setFile={setFile}
            required={kind === "story"}
          />
          {kind === "story" && (
            <label>
              Подпись <span className="muted">необязательно</span>
              <input
                name="caption"
                maxLength={180}
                placeholder="Как проходит твой день?"
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button wide">
            {busy
              ? "Сохраняем…"
              : kind === "profile"
                ? "Сохранить"
                : kind === "request"
                  ? "Отправить обращение"
                  : "Опубликовать"}
            <ArrowUpRight size={18} />
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
