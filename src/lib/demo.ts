import type { FeedItem, Session } from "./types";
// Fictional, read-only fixtures. Never imported by API handlers or database bootstrap.
export const demoSession: Session = {
  configured: false,
  profile: null,
  school: "БИЛ · Наша школа",
};
export const demoNews: FeedItem[] = [
  {
    id: "demo-1",
    title: "Наша команда — в финале!",
    body: "Вот это игра. Гордимся ребятами и ждём финал в пятницу 💙",
    category: "achievement",
    created_at: "2026-10-21T08:00:00Z",
    author_name: "Совет школы",
    media_id: "demo-team",
    total: 128,
  },
  {
    id: "demo-2",
    title: "Вечер настольных игр в дормитории",
    body: "В эту пятницу собираемся в общей комнате. Приносите любимые игры, зовите соседей и знакомьтесь с ребятами из других классов. Начинаем в 19:00.",
    category: "dormitory",
    created_at: "2026-10-20T12:00:00Z",
    author_name: "Жизнь в дормитории",
    media_id: "demo-courtyard",
    total: 18,
  },
  {
    id: "demo-3",
    title: "Школа, в которой слышен каждый",
    body: "В разделе обращений можно предложить идею или сообщить о школьной проблеме. Личные ситуации отправляйте конфиденциально: они доступны только автору и назначенным ответственным взрослым.",
    category: "news",
    created_at: "2026-10-19T09:00:00Z",
    author_name: "Редакция · пример",
    media_id: null,
    total: 31,
  },
];
export const demoStories: FeedItem[] = [
  "Наша команда",
  "После уроков",
  "Дормиторий",
  "Спорт",
].map((name, i) => ({
  id: "demo-story-" + i,
  caption: [
    "Маленький шаг к большой идее ✨",
    "День, который хочется запомнить",
    "Здесь начинается дружба",
    "Вместе можем больше",
  ][i],
  author_name: name,
  media_id: "demo-" + i,
  created_at: "2026-10-21T08:00:00Z",
}));
export const demoRequests: FeedItem[] = [
  {
    id: "demo-request",
    title: "Больше света у читального зала",
    body: "Вечером у входа темно. Предлагаем проверить освещение и заменить лампы.",
    category: "facilities",
    status: "progress",
    approved: true,
    confidential: false,
    response: "Проверяем освещение. Ответственный — хозяйственная служба.",
    created_at: "2026-10-20T08:00:00Z",
    total: 12,
    media_id: null,
  },
];

// Local illustrative AI-generated images: never used by real API data.
export function demoPhoto(id: string) {
  return id === "demo-team" || id === "demo-0" || id === "demo-3"
    ? "/demo/team.png"
    : "/demo/courtyard.png";
}
