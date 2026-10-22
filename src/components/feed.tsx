"use client";
import { useEffect, useState, useRef } from "react";
import {
  Heart,
  ArrowUpRight,
  ThumbsUp,
  Trash2,
  LockKeyhole,
  ChevronLeft,
  ChevronRight,
  Flag,
  Plus,
  Clock3,
} from "lucide-react";
import { api, command } from "@/lib/client";
import {
  categories,
  statuses,
  type FeedItem,
  type Page,
  type Profile,
} from "@/lib/types";
import { demoNews, demoRequests, demoStories, demoPhoto } from "@/lib/demo";
import { Avatar, Busy, Empty, Modal, date } from "./ui";

export function Feed({
  kind,
  view = "public",
  category = "",
  profile,
  demo = false,
  version = 0,
  onLogin,
}: {
  kind: "news" | "requests";
  view?: string;
  category?: string;
  profile: Profile | null;
  demo?: boolean;
  version?: number;
  onLogin: () => void;
}) {
  const [items, setItems] = useState<FeedItem[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<FeedItem | null>(null),
    [photo, setPhoto] = useState<FeedItem | null>(null),
    [deleting, setDeleting] = useState<FeedItem | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [rev, setRev] = useState(0);
  const enabled = Boolean(profile);
  const reactionLock = useRef(new Set<string>());
  const [pendingReactions, setPendingReactions] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setItems([]);
    setCursor(null);
    setError("");
    if (demo) {
      setItems(
        (kind === "news" ? demoNews : demoRequests).filter(
          (n) => !category || n.category === category,
        ),
      );
      return;
    }
    if (!enabled) return;
    setBusy(true);
    api<Page<FeedItem>>(
      `feed?kind=${kind}&view=${view}${category ? "&category=" + category : ""}`,
    )
      .then((p) => {
        if (active) {
          setItems(p.items);
          setCursor(p.cursor);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [kind, view, category, enabled, demo, version, rev]);
  async function more() {
    setBusy(true);
    setError("");
    try {
      const p = await api<Page<FeedItem>>(
        `feed?kind=${kind}&view=${view}${category ? "&category=" + category : ""}&cursor=${cursor}`,
      );
      setItems((v) => [
        ...v,
        ...p.items.filter((i) => !v.some((x) => x.id === i.id)),
      ]);
      setCursor(p.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function react(item: FeedItem) {
    if (demo) {
      setError(
        "Это отдельная демонстрация. Реакции доступны после подключения школы.",
      );
      return;
    }
    if (!profile) {
      onLogin();
      return;
    }
    if (reactionLock.current.has(item.id)) return;
    reactionLock.current.add(item.id);
    setPendingReactions([...reactionLock.current]);
    try {
      await command(kind === "news" ? "like" : "support", {
        id: item.id,
        enabled: !item.reacted,
      });
      setItems((v) =>
        v.map((i) =>
          i.id === item.id
            ? {
                ...i,
                reacted: !i.reacted,
                total: (i.total || 0) + (i.reacted ? -1 : 1),
              }
            : i,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      reactionLock.current.delete(item.id);
      setPendingReactions([...reactionLock.current]);
    }
  }
  async function remove(item: FeedItem) {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await command("delete_news", { id: item.id });
      setDeleting(null);
      setRev((v) => v + 1);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }
  return (
    <div className="feed">
      {error && (
        <div className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => setRev((v) => v + 1)}>
            Повторить
          </button>
        </div>
      )}
      {items.map((item, itemIndex) => (
        <article
          className={
            "post " + (kind === "requests" ? "request-card" : "news-post")
          }
          key={item.id}
        >
          <div className="post-top">
            <div className="author">
              <Avatar
                name={kind === "requests" ? "Ш" : item.author_name}
                id={item.author_avatar}
              />
              <span>
                <strong>
                  {kind === "requests"
                    ? item.confidential
                      ? "Конфиденциальное обращение"
                      : "Школьная проблема"
                    : item.author_name || "Редакция школы"}
                </strong>
                <small>
                  {date(item.created_at)}
                  {kind === "news" &&
                    ` · ${categories[item.category || "news"]}`}
                  {item.mine ? " · ваше обращение" : ""}
                </small>
              </span>
            </div>
            {kind === "news" &&
              profile &&
              (profile.role === "admin" ||
                profile.role === "moderator" ||
                (profile.is_editor && profile.id === item.author_id)) && (
                <button
                  className="icon-button danger"
                  aria-label="Удалить новость"
                  onClick={() => { setDeleting(item); setDeleteError(""); }}
                >
                  <Trash2 size={18} />
                </button>
              )}
            {item.confidential && <LockKeyhole size={18} />}
          </div>
          {item.media_id && kind === "news" && (
            <button className="photo-open" aria-label={"Открыть фото: " + (item.title || "публикация")} onClick={() => setPhoto(item)}>
            <img
              className="post-image"
              src={
                demo ? demoPhoto(item.media_id) : "/api/media/" + item.media_id
              }
              alt={item.title || "Фото публикации"}
              loading={itemIndex === 0 ? "eager" : "lazy"}
              fetchPriority={itemIndex === 0 ? "high" : "auto"}
              decoding="async"
            />
            </button>
          )}
          <div className="post-body">
            <div className="badges">
              <span className={"badge category-" + item.category}>
                {categories[item.category || "news"]}
              </span>
              {kind === "requests" && (
                <>
                  <span className={"badge status-" + item.status}>
                    {statuses[item.status || "received"]}
                  </span>
                  {!item.approved && !item.confidential && (
                    <span className="badge">На проверке</span>
                  )}
                </>
              )}
            </div>
            <h3>{item.title}</h3>
            <p className="preserve">{item.body}</p>
            {kind === "requests" && item.author_name && (
              <p className="fine">
                Автор: {item.author_name}
                {item.mine ? " (вы)" : " · видно ответственным"}
              </p>
            )}
            {item.response && (
              <div className="response">
                <strong>Ответ школы</strong>
                <p className="preserve">{item.response}</p>
              </div>
            )}
            <footer className="post-actions">
              {(kind === "news" || (item.approved && !item.confidential)) && (
                <button
                  className={"reaction " + (item.reacted ? "active" : "")}
                  onClick={() => react(item)}
                  disabled={pendingReactions.includes(item.id)}
                  aria-label={
                    kind === "news"
                      ? "Нравится, " + (item.total || 0)
                      : "Поддержать, " + (item.total || 0)
                  }
                  aria-pressed={Boolean(item.reacted)}
                >
                  {kind === "news" ? (
                    <Heart
                      size={19}
                      fill={item.reacted ? "currentColor" : "none"}
                    />
                  ) : (
                    <ThumbsUp size={18} />
                  )}
                  <span>{item.total || 0}</span>
                  {kind === "requests" && "Поддержать"}
                </button>
              )}
              {kind === "requests" ? (
                <button className="text-button" onClick={() => setDetail(item)}>
                  Подробнее <ArrowUpRight size={17} />
                </button>
              ) : (
                <span className="post-category">
                  {categories[item.category || "news"]}
                </span>
              )}
            </footer>
          </div>
        </article>
      ))}
      {busy && <Busy />}
      {!busy && !items.length && !error && (
        <Empty
          title={
            profile
              ? kind === "news"
                ? "Здесь появятся новости"
                : "Обращений пока нет"
              : "Школьная жизнь — внутри"
          }
        >
          {profile
            ? kind === "news"
              ? "Новые публикации школы будут здесь."
              : "Создайте обращение или загляните сюда позже."
            : "Войдите по приглашению, чтобы видеть материалы своей школы."}
        </Empty>
      )}
      {!profile && !demo && !busy && <button className="button guest-login" onClick={onLogin}>Войти в BilBook <ArrowUpRight size={18} /></button>}
      {photo && <Modal title={photo.author_name || "Фото"} close={() => setPhoto(null)} immersive>
        <img className="full-photo" src={demo ? demoPhoto(photo.media_id!) : "/api/media/" + photo.media_id} alt={photo.title || "Фото публикации"} />
        <p className="photo-caption">{photo.title}</p>
      </Modal>}
      {deleting && <Modal title="Удалить публикацию?" close={() => setDeleting(null)} busy={deleteBusy}>
        <div className="detail"><p>«{deleting.title}» исчезнет из ленты. Отменить удаление нельзя.</p>
          {deleteError && <p className="error" role="alert">{deleteError}</p>}
          <div className="form-links"><button className="button secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Оставить</button><button className="button danger-button" disabled={deleteBusy} onClick={() => remove(deleting)}>{deleteBusy ? "Удаляем…" : "Удалить"}</button></div>
        </div>
      </Modal>}
      {cursor && (
        <button
          className="button secondary wide"
          disabled={busy}
          onClick={more}
        >
          Показать ещё
        </button>
      )}
      {detail && (
        <RequestDetail
          item={detail}
          profile={profile}
          demo={demo}
          close={() => setDetail(null)}
          done={() => {
            setDetail(null);
            setRev((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function RequestDetail({
  item,
  profile,
  demo,
  close,
  done,
}: {
  item: FeedItem;
  profile: Profile | null;
  demo: boolean;
  close: () => void;
  done: () => void;
}) {
  const [history, setHistory] = useState<
      { id: string; status: string; response: string; created_at: string }[]
    >([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!demo);
  const canModerate =
    profile &&
    (item.confidential
      ? profile.is_responder && ["teacher", "admin"].includes(profile.role)
      : ["moderator", "admin"].includes(profile.role));
  useEffect(() => {
    if (demo) return;
    let active = true;
    api<{ history: typeof history }>("request/" + item.id)
      .then((v) => {
        if (active) setHistory(v.history);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [item.id, demo]);
  return (
    <Modal title={item.title || "Обращение"} close={close} busy={busy}>
      <div className="detail">
        <p className="preserve">{item.body}</p>
        {item.media_id && (
          <img
            src={"/api/media/" + item.media_id}
            alt="Фото к обращению"
            className="upload-preview"
          />
        )}
        <h3>История обращения</h3>
        {loading && <Busy />}
        {demo ? (
          <p className="muted">
            Демонстрационный пример · {statuses[item.status || "received"]}
          </p>
        ) : (
          history.map((h) => (
            <div className="history" key={h.id}>
              <span className="history-dot" />
              <div>
                <strong>{statuses[h.status]}</strong>
                <small>{date(h.created_at)}</small>
                <p className="preserve">{h.response}</p>
              </div>
            </div>
          ))
        )}
        {canModerate && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await command("moderate_request", {
                  id: item.id,
                  status: f.get("status"),
                  response: f.get("response"),
                  approved: !item.confidential && f.get("approved") === "on",
                });
                done();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <h3>Решение ответственного</h3>
              {!item.confidential && (
                <label className="check">
                  <input
                    type="checkbox"
                    name="approved"
                    defaultChecked={item.approved}
                  />{" "}
                  Одобрить для школьной ленты
                </label>
              )}
              <label>
                Статус
                <select name="status" defaultValue={item.status}>
                  {Object.entries(statuses).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ответ
                <textarea
                  name="response"
                  maxLength={4000}
                  rows={4}
                  defaultValue={item.response || ""}
                />
              </label>
              <p className="fine">
                {item.confidential
                  ? "Ответ увидят только автор и назначенные взрослые."
                  : "Перед публикацией уберите персональные обвинения и сведения из текста обращения. Если это личная ситуация, отклоните публичную публикацию и предложите автору конфиденциальный канал."}
              </p>
              <button className="button">
                {busy ? "Сохраняем…" : "Сохранить решение"}
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function Stories({
  profile,
  demo,
  onAdd,
  onLogin,
  version,
}: {
  profile: Profile | null;
  demo: boolean;
  onAdd: () => void;
  onLogin: () => void;
  version: number;
}) {
  const [items, setItems] = useState<FeedItem[]>([]),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (demo) {
      setItems(demoStories);
      return;
    }
    if (!profile) {
      setItems([]);
      return;
    }
    api<Page<FeedItem>>("feed?kind=stories")
      .then((v) => {
        if (active) {
          setItems(v.items);
          setCursor(v.cursor);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [profile?.id, demo, version]);
  useEffect(() => {
    if (demo) return;
    const t = setInterval(() => {
      setItems((v) =>
        v.filter((s) => !s.expires_at || Date.parse(s.expires_at) > Date.now()),
      );
    }, 1000);
    return () => clearInterval(t);
  }, [demo]);
  const index = items.findIndex((item) => item.id === selectedId);
  const current = index < 0 ? null : items[index];
  async function more() {
    setBusy(true);
    try {
      const v = await api<Page<FeedItem>>("feed?kind=stories&cursor=" + cursor);
      setItems((i) => [
        ...i,
        ...v.items.filter((s) => !i.some((x) => x.id === s.id)),
      ]);
      setCursor(v.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stories-section" aria-label="Истории школы">
      <div className="section-line">
        <h2>
          Истории <span>24 часа</span>
        </h2>
        <Clock3 size={17} />
      </div>
      <div className="story-row">
        <button
          className="story-item add-story"
          onClick={() => (profile ? onAdd() : onLogin())}
        >
          <span className="story-ring">
            <Plus size={27} />
          </span>
          <span>Ваша история</span>
        </button>
        {items.map((s, i) => {
          return (
            <button
              className="story-item"
              key={s.id}
              onClick={() => setSelectedId(s.id)}
            >
              <span className={"story-ring tone-" + (i % 4)}>
                {demo ? (
                  <img
                    className="story-thumb"
                    src={demoPhoto(s.media_id!, true)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <Avatar name={s.author_name} id={s.author_avatar} />
                )}
              </span>
              <span>{s.author_name || "Участник"}</span>
            </button>
          );
        })}
        {!items.length && (
          <p className="story-empty">
            Твой день в одном фото.
            <br /><span>Истории исчезают через 24 часа.</span>
          </p>
        )}
        {cursor && (
          <button
            className="icon-button"
            aria-label="Ещё истории"
            disabled={busy}
            onClick={more}
          >
            <ChevronRight />
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {current && (
        <StoryViewer
          item={current}
          index={index!}
          count={items.length}
          demo={demo}
          profile={profile}
          close={() => setSelectedId(null)}
          prev={() => setSelectedId(items[Math.max(0, index - 1)]?.id || null)}
          next={() => setSelectedId(items[index + 1]?.id || null)}
          deleted={() => {
            setItems((v) => v.filter((s) => s.id !== current.id));
            setSelectedId(null);
          }}
        />
      )}
    </section>
  );
}
function StoryViewer({
  item,
  index,
  count,
  demo,
  profile,
  close,
  prev,
  next,
  deleted,
}: {
  item: FeedItem;
  index: number;
  count: number;
  demo: boolean;
  profile: Profile | null;
  close: () => void;
  prev: () => void;
  next: () => void;
  deleted: () => void;
}) {
  const [report, setReport] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setReport(false);
    setError("");
  }, [item.id]);
  return (
    <Modal title={item.author_name || "История"} close={close} busy={busy} immersive>
      <div
        className="story-view"
        onKeyDown={(e) => {
          if (busy || (e.target as HTMLElement).tagName === "TEXTAREA") return;
          if (e.key === "ArrowRight") next();
          if (e.key === "ArrowLeft") prev();
        }}
      >
        <div className="story-progress">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className={i <= index ? "seen" : ""} />
          ))}
        </div>
        {demo ? (
          <figure className="demo-story-photo">
            <img
              className="story-photo"
              src={demoPhoto(item.media_id!)}
              alt={item.caption || "Демонстрационная история"}
            />
            <figcaption>
              {item.caption}
              <small>Вымышленная демонстрационная история</small>
            </figcaption>
          </figure>
        ) : (
          <img
            src={"/api/media/" + item.media_id}
            alt={item.caption || "История школы"}
            className="story-photo"
          />
        )}
        <p>{!demo && item.caption}</p>
        <div className="story-controls">
          <button
            className="icon-button"
            aria-label="Предыдущая история"
            disabled={busy || index === 0}
            onClick={prev}
          >
            <ChevronLeft />
          </button>
          <small>
            {index + 1} / {count}
          </small>
          <button
            className="icon-button"
            aria-label="Следующая история"
            disabled={busy}
            onClick={next}
          >
            <ChevronRight />
          </button>
        </div>
        {!demo && (
          <div className="form-links">
            <button
              className="text-button"
              onClick={() => setReport((v) => !v)}
            >
              <Flag size={16} />
              Пожаловаться
            </button>
            {(item.author_id === profile?.id ||
              ["moderator", "admin"].includes(profile?.role || "")) && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await command("delete_story", { id: item.id });
                    deleted();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={16} />
                Удалить
              </button>
            )}
          </div>
        )}
        {report && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await command("report", {
                  id: item.id,
                  reason: f.get("reason"),
                });
                setReport(false);
                setError("Жалоба передана модератору.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Причина жалобы
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                rows={3}
              />
            </label>
            <button className="button" disabled={busy}>
              Отправить жалобу
            </button>
          </form>
        )}
        {error && (
          <p role="status" className="notice">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
