"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Copy, ShieldCheck, TicketPlus, Check } from "lucide-react";
import { api, command } from "@/lib/client";
import { roles, type Profile, type Page } from "@/lib/types";
import { Busy, Empty, Modal, date } from "./ui";
import { Feed } from "./feed";
type Row = {
  id: string;
  created_at: string;
  label?: string;
  expires_at?: string;
  uses?: number;
  max_uses?: number;
  revoked?: boolean;
  reason?: string;
  resolved?: boolean;
  story_id?: string;
  action?: string;
  target_id?: string;
  actor_id?: string;
};
export function Admin({
  profile,
  onPublish,
  version: externalVersion = 0,
}: {
  profile: Profile;
  onPublish: () => void;
  version?: number;
}) {
  const [tab, setTab] = useState(
      ["moderator", "admin"].includes(profile.role) ? "review" : "confidential",
    ),
    [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [token, setToken] = useState(""),
    [copied, setCopied] = useState(false);
  const tabs = [
    ...(["moderator", "admin"].includes(profile.role)
      ? [
          ["review", "Обращения"],
          ["news", "Публикации"],
          ["reports", "Жалобы"],
        ]
      : []),
    ...(profile.is_responder && ["teacher", "admin"].includes(profile.role)
      ? [["confidential", "Личные обращения"]]
      : []),
    ...(profile.role === "admin"
      ? [
          ["invitations", "Приглашения"],
          ["profiles", "Участники"],
          ["audit_log", "Журнал"],
        ]
      : []),
  ];
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const v = await command("invite", {
        label: f.get("label"),
        days: Number(f.get("days")),
        max_uses: Number(f.get("max_uses")),
      });
      setToken(v.token as string);
      setCopied(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="page-title">
        <div>
          <p className="eyebrow">ДОСТУП ПО РОЛИ</p>
          <h1>Управление школой</h1>
        </div>
        <ShieldCheck className="title-icon" />
      </div>
      <div className="chips admin-tabs">
        {tabs.map(([key, label]) => (
          <button
            className={tab === key ? "selected" : ""}
            key={key}
            onClick={() => {
              setTab(key);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "review" || tab === "confidential" ? (
        <>
          <p className="notice">
            {tab === "confidential"
              ? "Этот раздел доступен только назначенным взрослым. Тексты и имена не попадают в школьную ленту."
              : "Проверьте содержание перед одобрением. Откройте «Подробнее», чтобы изменить статус и ответить автору."}
          </p>
          <Feed
            key={tab}
            kind="requests"
            view={tab}
            profile={profile}
            onLogin={() => {}}
          />
        </>
      ) : tab === "news" ? (
        <>
          <button
            className="button"
            onClick={onPublish}
            disabled={!profile.is_editor}
          >
            Новая публикация
          </button>
          <Feed
            kind="news"
            version={externalVersion}
            profile={profile}
            onLogin={() => {}}
          />
        </>
      ) : (
        <>
          {tab === "invitations" && (
            <div className="panel">
              <h2>
                <TicketPlus size={21} /> Создать приглашение
              </h2>
              <form className="form" onSubmit={invite}>
                <fieldset disabled={busy}>
                  <label>
                    Для кого
                    <input
                      name="label"
                      maxLength={100}
                      placeholder="Например, набор 10 класса"
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Действует, дней
                      <input
                        type="number"
                        name="days"
                        min={1}
                        max={30}
                        defaultValue={7}
                        required
                      />
                    </label>
                    <label>
                      Использований
                      <input
                        type="number"
                        name="max_uses"
                        min={1}
                        max={100}
                        defaultValue={1}
                        required
                      />
                    </label>
                  </div>
                  <button className="button">
                    {busy ? "Создаём…" : "Создать код"}
                  </button>
                </fieldset>
              </form>
              {token && (
                <div className="token-box">
                  <p>Скопируйте код сейчас. Повторно он не показывается.</p>
                  <code>{token}</code>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(token);
                        setCopied(true);
                      } catch {
                        setError("Скопируйте код вручную из поля выше.");
                      }
                    }}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
                    {copied ? "Скопировано" : "Скопировать код"}
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <AdminList key={tab} kind={tab} version={version} profile={profile} />
        </>
      )}
    </section>
  );
}
function AdminList({
  kind,
  version,
  profile,
}: {
  kind: string;
  version: number;
  profile: Profile;
}) {
  const [items, setItems] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [rev, setRev] = useState(0);
  const [reportedStory, setReportedStory] = useState<{
    media_id: string;
    caption: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<Page<Row>>("admin?kind=" + kind)
      .then((v) => {
        if (active) {
          setItems(v.items);
          setCursor(v.cursor);
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
  }, [kind, version, rev]);
  async function act(action: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      await command(action, payload);
      setRev((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-list">
      {items.map((row) => (
        <div className="panel" key={row.id}>
          {kind === "profiles" ? (
            <UserEditor
              person={row as unknown as Profile}
              self={row.id === profile.id}
              save={(payload) => act("user", payload)}
              busy={busy}
            />
          ) : kind === "invitations" ? (
            <>
              <div className="section-line">
                <h3>{row.label || "Приглашение"}</h3>
                <span className="badge">
                  {row.revoked
                    ? "Отозвано"
                    : Date.parse(row.expires_at || "") < Date.now()
                      ? "Истекло"
                      : "Активно"}
                </span>
              </div>
              <p className="muted">
                {row.uses} / {row.max_uses} использований · до{" "}
                {date(row.expires_at!)}
              </p>
              {!row.revoked && (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => act("revoke_invite", { id: row.id })}
                >
                  Отозвать приглашение
                </button>
              )}
            </>
          ) : kind === "reports" ? (
            <>
              <span className="badge">
                {row.resolved ? "Рассмотрено" : "Новая жалоба"}
              </span>
              <p className="preserve">{row.reason}</p>
              <p className="fine">
                {date(row.created_at)} · история {row.story_id || "уже удалена"}
              </p>
              {row.story_id && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      setReportedStory(await api("story/" + row.story_id));
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Посмотреть историю
                </button>
              )}
              {!row.resolved && (
                <div className="form-links">
                  {row.story_id && (
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => act("delete_story", { id: row.story_id })}
                    >
                      Удалить историю
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => act("resolve_report", { id: row.id })}
                  >
                    Отметить рассмотренной
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <strong>{row.action}</strong>
              <p className="fine">
                {date(row.created_at)}
                <br />
                Участник: {row.actor_id || "удалён"}
                <br />
                Объект: {row.target_id || "—"}
              </p>
            </>
          )}
        </div>
      ))}
      {reportedStory && (
        <Modal title="История из жалобы" close={() => setReportedStory(null)}>
          <img
            src={"/api/media/" + reportedStory.media_id}
            alt={reportedStory.caption || "История из жалобы"}
            className="story-photo"
          />
          <p className="preserve">{reportedStory.caption}</p>
        </Modal>
      )}
      {busy && <Busy />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!busy && !items.length && !error && (
        <Empty title="Здесь пока пусто">
          Новые записи появятся в этом разделе.
        </Empty>
      )}
      {cursor && (
        <button
          className="button secondary wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const v = await api<Page<Row>>(
                "admin?kind=" + kind + "&cursor=" + cursor,
              );
              setItems((i) => [...i, ...v.items]);
              setCursor(v.cursor);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Показать ещё
        </button>
      )}
    </div>
  );
}
function UserEditor({
  person,
  self,
  save,
  busy,
}: {
  person: Profile;
  self: boolean;
  save: (payload: unknown) => void;
  busy: boolean;
}) {
  const [role, setRole] = useState(person.role);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          id: person.id,
          role,
          is_editor:
            ["teacher", "moderator", "admin"].includes(role) &&
            f.get("is_editor") === "on",
          is_responder:
            ["teacher", "admin"].includes(role) &&
            f.get("is_responder") === "on",
          blocked: f.get("blocked") === "on",
        });
      }}
    >
      <h3>
        {person.name}
        {self ? " · вы" : ""}
      </h3>
      <p className="fine">{person.id}</p>
      {person.requested_role === "teacher" && person.role === "student" && <p className="notice">Заявка на роль учителя. Подтвердите личность сотрудника перед назначением.</p>}
      <fieldset disabled={self || busy}>
        <label>
          Роль
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Profile["role"])}
          >
            {Object.entries(roles).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="is_editor"
            defaultChecked={person.is_editor}
            disabled={role === "student"}
          />{" "}
          Редактор новостей
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="is_responder"
            defaultChecked={person.is_responder}
            disabled={!["teacher", "admin"].includes(role)}
          />{" "}
          Ответственный взрослый
        </label>
        <p className="fine">
          Назначайте доступ к личным обращениям только взрослому сотруднику
          школы после проверки личности.
        </p>
        <label className="check">
          <input
            type="checkbox"
            name="blocked"
            defaultChecked={person.blocked}
          />{" "}
          Заблокировать доступ
        </label>
        {!self && <button className="button secondary">Сохранить права</button>}
      </fieldset>
    </form>
  );
}
