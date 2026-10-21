export type Role = "student" | "teacher" | "moderator" | "admin";
export type Profile = {
  id: string;
  school_id: string;
  name: string;
  role: Role;
  is_editor: boolean;
  is_responder: boolean;
  blocked: boolean;
  class_name: string | null;
  dormitory: boolean;
  avatar_id: string | null;
};
export type Session = {
  configured: boolean;
  profile: Profile | null;
  school?: string;
  email?: string;
  error?: string;
};
export type FeedItem = {
  id: string;
  title?: string;
  body?: string;
  category?: string;
  created_at: string;
  expires_at?: string;
  author_id?: string;
  author_name?: string;
  author_avatar?: string | null;
  caption?: string;
  media_id: string | null;
  confidential?: boolean;
  approved?: boolean;
  status?: string;
  response?: string;
  total?: number;
  reacted?: boolean;
  mine?: boolean;
};
export type Page<T> = { items: T[]; cursor: string | null };
export const categories: Record<string, string> = {
  news: "Новости",
  achievement: "Достижения",
  event: "Мероприятия",
  dormitory: "Дормиторий",
  canteen: "Столовая",
  facilities: "Инфраструктура",
  idea: "Предложение",
  personal: "Личная ситуация",
};
export const statuses: Record<string, string> = {
  received: "Получено",
  progress: "В работе",
  resolved: "Решено",
  rejected: "Отклонено",
};
export const roles: Record<Role, string> = {
  student: "Ученик",
  teacher: "Учитель",
  moderator: "Модератор",
  admin: "Администратор",
};
export const appName = process.env.NEXT_PUBLIC_APP_NAME || "BilBook";
