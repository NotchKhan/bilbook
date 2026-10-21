"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h1>Страницу не удалось открыть</h1>
      <p>
        Попробуйте ещё раз. Если ошибка повторяется, обратитесь к администратору
        школы.
      </p>
      <button className="button" onClick={reset}>
        Повторить
      </button>
    </div>
  );
}
