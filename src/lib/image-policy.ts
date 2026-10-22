// Shared browser/server limits. Request attachments retain detail for school staff.
export function imagePolicy(purpose: string) {
  if (purpose === "avatar") return { edge: 256, quality: 76 };
  if (purpose === "news" || purpose === "story") return { edge: 1440, quality: 76 };
  return { edge: 1600, quality: 78 };
}
