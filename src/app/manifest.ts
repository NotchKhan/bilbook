import type { MetadataRoute } from "next";
import { appName } from "@/lib/types";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Твоя школа. Твои люди.",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fc",
    theme_color: "#0666ff",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
