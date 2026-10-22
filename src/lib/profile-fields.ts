export const schoolClasses = [7, 8, 9, 10, 11].flatMap((grade) =>
  ["A", "B", "C"].map((letter) => `${grade}${letter}`),
);
export const classPattern = /^(7|8|9|10|11)[ABC]$/;
