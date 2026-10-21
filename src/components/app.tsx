"use client";
import { useEffect, useState } from "react";
import {
  Home,
  Newspaper,
  MessageSquareText,
  UserRound,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  LogOut,
  Settings2,
  Download,
  Smartphone,
  School,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "@/lib/client";
import { appName, categories, roles, type Session } from "@/lib/types";
import { demoSession } from "@/lib/demo";
import { AuthForm, Compose } from "./forms";
import { Feed, Stories } from "./feed";
import { Admin } from "./admin";
import { Avatar, Busy, Modal } from "./ui";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const navigation = [
  { id: "home", label: "Главная", Icon: Home },
  { id: "news", label: "Новости", Icon: Newspaper },
  { id: "requests", label: "Обращения", Icon: MessageSquareText },
  { id: "profile", label: "Профиль", Icon: UserRound },
];
function Wordmark() {
  return (
    <span className="wordmark">
      {appName === "BilBook" ? (
        <>
          Bil<span>Book</span>
        </>
      ) : (
        appName
      )}
    </span>
  );
}
export function App({ demo = false }: { demo?: boolean }) {
  const [session, setSession] = useState<Session>(
      demo ? demoSession : { configured: false, profile: null },
    ),
    [loading, setLoading] = useState(!demo),
    [tab, setTab] = useState("home"),
    [auth, setAuth] = useState(false),
    [reset, setReset] = useState(false),
    [compose, setCompose] = useState<
      "story" | "news" | "request" | "profile" | null
    >(null),
    [category, setCategory] = useState(""),
    [requestView, setRequestView] = useState("public"),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [installHelp, setInstallHelp] = useState(false),
    [installPrompt, setInstallPrompt] = useState<InstallEvent | null>(null),
    [offline, setOffline] = useState(false),
    [deletion, setDeletion] = useState(false),
    [busy, setBusy] = useState(false);
  const profile = session.profile;
  const manager =
    profile &&
    (["admin", "moderator"].includes(profile.role) ||
      (profile.is_responder && profile.role === "teacher"));
  async function refresh() {
    try {
      const s = await api<Session>("session");
      setSession(s);
      if (s.error) setError(s.error);
      if (!s.profile) {
        setCompose(null);
        setTab((t) => (t === "admin" ? "home" : t));
      }
    } catch (e) {
      setSession({ configured: false, profile: null });
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (demo) return;
    void refresh();
    const params = new URLSearchParams(location.search);
    if (params.get("reset") === "1") {
      setReset(true);
      setAuth(true);
    }
    if (params.get("auth_error"))
      setError(
        "Ссылка недействительна или истекла. Повторите вход или запросите новое письмо.",
      );
    if (location.search) history.replaceState(null, "", location.pathname);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const page = (e: PageTransitionEvent) => {
      if (e.persisted) location.reload();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", page);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", page);
    };
  }, [demo]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    const handle = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handle);
    const installed = () => setInstallPrompt(null);
    window.addEventListener("appinstalled", installed);
    const network = () => setOffline(!navigator.onLine);
    network();
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      window.removeEventListener("beforeinstallprompt", handle);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  function login() {
    if (demo) {
      location.href = "/";
      return;
    }
    setAuth(true);
  }
  function create(kind: "story" | "news" | "request" | "profile") {
    if (!profile) {
      login();
      return;
    }
    setCompose(kind);
  }
  function navigate(id: string) {
    setTab(id);
    setCategory("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function signout() {
    setBusy(true);
    setError("");
    try {
      await api("auth", { action: "signout" });
      setSession((s) => ({
        ...s,
        profile: null,
        email: undefined,
        school: undefined,
      }));
      setVersion((v) => v + 1);
      navigator.serviceWorker?.controller?.postMessage({ type: "LOGOUT" });
      location.replace("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href={demo ? "/demo" : "/"}>
            <Wordmark />
          </a>
          <nav className="desktop-nav" aria-label="Основная навигация">
            {navigation.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => navigate(id)}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
              >
                <Icon size={21} />
                {label}
                {tab === id && <span className="nav-dot" />}
              </button>
            ))}
            {manager && (
              <button
                onClick={() => navigate("admin")}
                className={tab === "admin" ? "active" : ""}
              >
                <Settings2 size={21} />
                Управление
              </button>
            )}
          </nav>
          <div className="sidebar-spacer" />
          <button className="install-help" onClick={() => setInstallHelp(true)}>
            <Smartphone size={20} />
            <span>
              Установить BilBook<small>Инструкция для телефона</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button
            className="sidebar-profile"
            onClick={() => (profile ? navigate("profile") : login())}
          >
            <Avatar name={profile?.name || "Гость"} id={profile?.avatar_id} />
            <span>
              <strong>{profile?.name || "Вход в BilBook"}</strong>
              <small>
                {profile ? roles[profile.role] : "Войти по приглашению"}
              </small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="mobile-heading">
              <a href={demo ? "/demo" : "/"} aria-label="На главную">
                <Wordmark />
              </a>
              <p>{session.school || "БИЛ · Наша школа"}</p>
            </div>
            <span className="school-switch">
              <School size={19} />
              {session.school || "БИЛ / КТЛ"}
              <span className="school-tag">сообщество</span>
            </span>
            <div className="topbar-right">
              <button
                className="header-create"
                aria-label="Добавить историю"
                onClick={() => create("story")}
              >
                <Plus size={24} />
              </button>
              <span className="private-label">
                <span />
                Закрытое пространство
              </span>
              <button
                className="mobile-avatar"
                aria-label="Открыть профиль"
                onClick={() => navigate("profile")}
              >
                <Avatar name={profile?.name || "Б"} id={profile?.avatar_id} />
              </button>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <span>
                <strong>Демо</strong> · Вымышленные фото и записи, без
                сохранения.
              </span>
              <a href="/">
                К приложению <ArrowUpRight size={16} />
              </a>
            </div>
          )}
          {offline && (
            <div className="error offline" role="status">
              <WifiOff size={18} />
              Нет интернета. Для школьных материалов нужно соединение.
            </div>
          )}
          {!demo && !loading && !session.configured && (
            <div className="setup-banner">
              <span>
                <span className="setup-dot" />
                Инфраструктура подготовлена · Supabase ещё не подключён
              </span>
              <a href="/demo">
                Посмотреть демо <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          {error && (
            <div className="error global-error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Закрыть уведомление"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div
            className={
              "content-grid " +
              (["profile", "admin"].includes(tab) ? "single" : "")
            }
          >
            <main id="main-content">
              {loading ? (
                <div className="loading-screen">
                  <Busy />
                </div>
              ) : (
                <>
                  {(tab === "home" || tab === "news") && (
                    <>
                      {tab === "home" ? (
                        <>
                          <Stories
                            profile={profile}
                            demo={demo}
                            onAdd={() => create("story")}
                            onLogin={login}
                            version={version}
                          />
                        </>
                      ) : (
                        <div className="page-title">
                          <div>
                            <h1>Новости</h1>
                          </div>
                        </div>
                      )}
                      <div
                        className={
                          "section-line feed-title " +
                          (tab === "home" ? "visually-hidden" : "")
                        }
                      >
                        <h2>
                          {tab === "home"
                            ? "Школьные новости"
                            : "Школьная лента"}
                        </h2>
                        {tab === "news" && profile?.is_editor && (
                          <button
                            className="text-button"
                            onClick={() => create("news")}
                          >
                            <Plus size={17} />
                            Написать
                          </button>
                        )}
                      </div>
                      {(tab === "home" || tab === "news") && (
                        <div
                          className="chips feed-tabs"
                          aria-label="Категории новостей"
                        >
                          {[
                            ["", "Все записи"],
                            ...Object.entries(categories).filter(([k]) =>
                              [
                                "news",
                                "achievement",
                                "event",
                                "dormitory",
                              ].includes(k),
                            ),
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              className={category === key ? "selected" : ""}
                              aria-pressed={category === key}
                              onClick={() => setCategory(key)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                      {tab === "home" && (
                        <div className="home-actions">
                          <button
                            className="request-prompt"
                            onClick={() => create("request")}
                          >
                            <MessageSquareText size={22} />
                            <span>Есть идея или проблема?</span>
                            <strong>Обратиться</strong>
                          </button>
                          {profile?.is_editor && (
                            <button
                              className="button editor-compose"
                              onClick={() => create("news")}
                            >
                              <Plus size={18} /> Новая публикация
                            </button>
                          )}
                        </div>
                      )}
                      <Feed
                        key={tab}
                        kind="news"
                        category={category}
                        profile={profile}
                        demo={demo}
                        version={version}
                        onLogin={login}
                      />
                    </>
                  )}
                  {tab === "requests" && (
                    <>
                      <div className="page-title">
                        <div>
                          <h1>Обращения</h1>
                          <p className="muted">
                            Проблема, предложение или личная ситуация.
                          </p>
                        </div>
                      </div>
                      <div className="request-intro">
                        <div>
                          <ShieldCheck size={25} />
                          <h3>Выбери, кому рассказать</h3>
                          <p>
                            Школьные проблемы — через проверку в общую ленту.
                            <br />
                            Личные ситуации — только назначенным взрослым.
                          </p>
                        </div>
                        <button
                          className="button"
                          onClick={() => create("request")}
                        >
                          <Plus size={18} />
                          Создать обращение
                        </button>
                      </div>
                      <div className="chips">
                        {[
                          ["public", "Школьные"],
                          ["mine", "Мои обращения"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            className={requestView === key ? "selected" : ""}
                            aria-pressed={requestView === key}
                            onClick={() => {
                              if (!profile && !demo) {
                                login();
                                return;
                              }
                              setRequestView(key);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {demo && requestView === "mine" ? (
                        <div className="empty">
                          <h3>Личные данные в демо не используются</h3>
                          <p>
                            После входа здесь будут ваши обращения, ответы и
                            статусы.
                          </p>
                        </div>
                      ) : (
                        <Feed
                          kind="requests"
                          view={requestView}
                          profile={profile}
                          demo={demo}
                          version={version}
                          onLogin={login}
                        />
                      )}
                    </>
                  )}
                  {tab === "profile" && (
                    <>
                      <div className="page-title">
                        <div>
                          <h1>Профиль</h1>
                        </div>
                      </div>
                      {profile ? (
                        <div className="panel profile-panel">
                          <Avatar
                            name={profile.name}
                            id={profile.avatar_id}
                            size="large"
                          />
                          <h2>{profile.name}</h2>
                          <p className="muted">{session.school}</p>
                          <span className="badge">{roles[profile.role]}</span>
                          <dl>
                            <div>
                              <dt>Email</dt>
                              <dd>{session.email}</dd>
                            </div>
                            <div>
                              <dt>Класс</dt>
                              <dd>{profile.class_name || "Не указан"}</dd>
                            </div>
                            <div>
                              <dt>Дормиторий</dt>
                              <dd>
                                {profile.dormitory ? "Проживаю" : "Не отмечено"}
                              </dd>
                            </div>
                          </dl>
                          <div className="profile-actions">
                            <button
                              className="button"
                              onClick={() => create("profile")}
                            >
                              Редактировать профиль
                            </button>
                            {manager && (
                              <button
                                className="button secondary"
                                onClick={() => navigate("admin")}
                              >
                                <Settings2 size={18} />
                                Управление школой
                              </button>
                            )}
                            <button
                              className="text-button"
                              onClick={() => {
                                setReset(true);
                                setAuth(true);
                              }}
                            >
                              Изменить пароль
                            </button>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={signout}
                            >
                              <LogOut size={17} />
                              Выйти
                            </button>
                          </div>
                          <div className="account-deletion">
                            <p className="fine">
                              При удалении аккаунта личные фото будут удалены, а
                              тексты опубликованных новостей и обращений
                              сохранятся без привязки к профилю.
                            </p>
                            <button
                              className="text-button danger"
                              onClick={() => setDeletion(true)}
                            >
                              Удалить аккаунт
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="panel guest-profile">
                          <div className="guest-symbol">
                            <UserRound size={35} />
                          </div>
                          <h2>Вход в BilBook</h2>
                          <p>
                            Твой профиль, истории и школьное сообщество
                            <br />
                            доступны после входа по приглашению.
                          </p>
                          <button className="button" onClick={login}>
                            Войти в сообщество <ArrowUpRight size={18} />
                          </button>
                        </div>
                      )}
                      <div className="panel install-panel">
                        <Smartphone />
                        <div>
                          <h3>Установить BilBook</h3>
                          <p className="muted">
                            Добавь приложение на главный экран.
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setInstallHelp(true)}
                        >
                          Как установить <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </>
                  )}
                  {tab === "admin" && manager && profile && (
                    <Admin
                      profile={profile}
                      version={version}
                      onPublish={() => create("news")}
                    />
                  )}
                </>
              )}
            </main>
          </div>
          <footer className="mobile-footer-note">
            <ShieldCheck size={14} />
            Только твоя школа · {appName}
          </footer>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Навигация на телефоне">
        {navigation.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => navigate(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {auth && (
        <AuthForm
          configured={session.configured}
          reset={reset}
          close={() => {
            setAuth(false);
            setReset(false);
          }}
          done={() => {
            setAuth(false);
            setReset(false);
            void refresh();
            setVersion((v) => v + 1);
          }}
        />
      )}
      {compose && profile && (
        <Compose
          demo={demo}
          kind={compose}
          profile={profile}
          close={() => setCompose(null)}
          done={() => {
            setCompose(null);
            void refresh();
            setVersion((v) => v + 1);
          }}
        />
      )}
      {installHelp && (
        <Modal
          title="Школа на главном экране"
          close={() => setInstallHelp(false)}
        >
          <div className="detail">
            <p>
              Приложению нужен интернет. Личные обращения и ответы не
              сохраняются для работы офлайн.
            </p>
            {installPrompt && (
              <button
                className="button wide"
                onClick={async () => {
                  await installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
              >
                <Download size={18} />
                Установить приложение
              </button>
            )}
            <div className="install-instructions">
              <h3>Android · Chrome</h3>
              <p>
                Открой меню ⋮ → «Добавить на главный экран» или «Установить
                приложение», если браузер предлагает эту возможность.
              </p>
              <h3>iPhone · Safari</h3>
              <p>Нажми «Поделиться» → «На экран “Домой”» → «Добавить».</p>
            </div>
          </div>
        </Modal>
      )}
      {deletion && (
        <Modal
          title="Удаление аккаунта"
          busy={busy}
          close={() => setDeletion(false)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("account/delete", { password: f.get("password") });
                location.replace("/");
              } catch (e) {
                setError((e as Error).message);
                setDeletion(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Профиль, доступ к школе и ваши фотографии будут удалены. История
              обращений и тексты новостей сохранятся без привязки к профилю.
              Восстановить аккаунт этим действием нельзя.
            </p>
            <label>
              Подтвердите текущим паролем
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <button className="button danger-button" disabled={busy}>
              {busy ? "Удаляем…" : "Удалить мой аккаунт"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
