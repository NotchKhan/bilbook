"use client";
import { useState } from "react";
import { ArrowRight, GraduationCap, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import { schoolClasses } from "@/lib/profile-fields";
import type { Session } from "@/lib/types";

export function EnrollmentFields({ suggestedName = "" }: { suggestedName?: string }) {
  const [kind, setKind] = useState("student");
  return <>
    <label>Школа<select name="school" defaultValue="shymkent-1"><option value="shymkent-1">ШЫМКЕНТ БИЛ #1 для юношей</option></select></label>
    <div className="form-grid">
      <label>Имя<input name="first_name" autoComplete="given-name" defaultValue={suggestedName.split(" ")[0] || ""} required maxLength={39} /></label>
      <label>Фамилия<input name="last_name" autoComplete="family-name" defaultValue={suggestedName.split(" ").slice(1).join(" ")} required maxLength={39} /></label>
    </div>
    <label>Я<select name="requested_role" value={kind} onChange={(e) => setKind(e.target.value)}><option value="student">Ученик</option><option value="teacher">Учитель</option></select></label>
    <label>{kind === "teacher" ? "Классное руководство · необязательно" : "Мой класс"}<select name="class_name" required={kind === "student"} defaultValue=""><option value="">{kind === "teacher" ? "Без класса" : "Выбрать класс"}</option>{schoolClasses.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
    {kind === "teacher" && <p className="fine">Права учителя подтвердит администратор. До подтверждения — обычный доступ участника.</p>}
    <label>Код приглашения<input name="invitation_token" required minLength={32} maxLength={128} autoComplete="off" spellCheck={false} placeholder="Код от администратора школы" /></label>
  </>;
}
export function Welcome({ session, done }: { session: Session; done: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const onboard = Boolean(session.onboarding);
  async function google() {
    setBusy(true); setError("");
    try { const result = await api<{url: string}>("auth", { action: "google" }); window.location.assign(result.url); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="welcome" id="main-content">
    <section className="welcome-story">
      <a className="wordmark" href="/">Bil<span>Book</span></a>
      <div className="welcome-copy"><span className="welcome-school"><GraduationCap size={20} /> ШЫМКЕНТ БИЛ #1 для юношей</span><h1>Своя школа.<br />Свои люди.</h1><p>Моменты, новости и друзья — в одном месте.</p></div>
      <div className="welcome-footer"><ShieldCheck size={16} /> Закрытое сообщество · по приглашению</div>
    </section>
    <section className="welcome-card">
      <h2>{onboard ? "Знакомимся?" : mode === "signup" ? "Создать аккаунт" : mode === "reset" ? "Восстановить пароль" : "С возвращением"}</h2>
      <p className="muted">{onboard ? "Заполни профиль и введи код своей школы." : "Твой BilBook начинается здесь."}</p>
      {!session.configured && <p className="notice">Подключение временно недоступно. Попробуйте позже.</p>}
      {!onboard && mode !== "reset" && <><button className="button google-button wide" disabled={busy || !session.configured} onClick={google}><span aria-hidden="true" className="google-letter">G</span> Продолжить с Google</button><div className="auth-divider">или по email</div><div className="segmented"><button disabled={busy} className={mode === "signin" ? "selected" : ""} onClick={() => {setMode("signin");setMessage("");setError("");}}>Вход</button><button disabled={busy} className={mode === "signup" ? "selected" : ""} onClick={() => {setMode("signup");setMessage("");setError("");}}>Регистрация</button></div></>}
      <form className="form" onSubmit={async e => {
        e.preventDefault(); setBusy(true);setError("");setMessage("");
        const fields = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const result = await api<{message?: string}>(onboard ? "enroll" : "auth", onboard ? fields : { ...fields, action: mode });
          if (result.message) setMessage(result.message); else done();
        } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
      }}>
        <fieldset disabled={busy || !session.configured || Boolean(message)}>
          {(onboard || mode === "signup") && <EnrollmentFields suggestedName={session.suggestedName} />}
          {!onboard && <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@gmail.com" /></label>}
          {!onboard && mode !== "reset" && <label>Пароль<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 10 : 1} maxLength={128} required />{mode === "signup" && <small>Не менее 10 символов</small>}</label>}
          <button className="button wide" type="submit">{busy ? "Подождите…" : onboard ? "Присоединиться" : mode === "signup" ? "Создать аккаунт" : mode === "reset" ? "Получить ссылку" : "Войти"}<ArrowRight size={18}/></button>
        </fieldset>
      </form>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
      {session.error && <p className="error" role="alert">{session.error}</p>}
      <div className="form-links">{onboard ? <button className="text-button" disabled={busy} onClick={async () => {setBusy(true);try {await api("auth",{action:"signout"});done();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Другой аккаунт</button> : <button className="text-button" disabled={busy} onClick={() => {setMode(mode === "reset" ? "signin" : "reset");setMessage("");setError("");}}>{mode === "reset" ? "Вернуться ко входу" : "Забыли пароль?"}</button>}</div>
      <p className="fine">Приглашение выдаёт администратор школы. Пароль Google вводится только на странице Google.</p>
      <nav className="auth-info-links fine" aria-label="О сервисе"><a href="/privacy">Конфиденциальность</a><a href="/terms">Правила сообщества</a></nav>
    </section>
  </main>;
}
