import Link from "next/link";

export function PublicInfo({ title, children }: { title: string; children: React.ReactNode }) {
  return <main id="main-content" className="public-info">
    <Link className="wordmark" href="/">Bil<span>Book</span></Link>
    <header><p className="muted">ШЫМКЕНТ БИЛ #1 для юношей</p><h1>{title}</h1><p className="fine">Обновлено 22 октября 2026</p></header>
    <article>{children}</article>
    <nav aria-label="О сервисе"><Link href="/">На главную</Link><Link href="/privacy">Конфиденциальность</Link><Link href="/terms">Правила</Link></nav>
  </main>;
}
