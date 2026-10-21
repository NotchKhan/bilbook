import type { Metadata, Viewport } from "next";
import { appName } from "@/lib/types";
import "./globals.css";
import "./controls.css";
import "./social.css";
export const metadata: Metadata = {
  title: appName + " · Школьное сообщество",
  description:
    "Закрытое школьное сообщество БИЛ / КТЛ. Истории, новости и обращения своей школы.",
  applicationName: appName,
  appleWebApp: { capable: true, statusBarStyle: "default", title: appName },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f8fc",
  viewportFit: "cover",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main-content">
          К содержанию
        </a>
        {children}
      </body>
    </html>
  );
}
