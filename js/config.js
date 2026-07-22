export const TILE = 28;

export const MAP_W = 72;
export const MAP_H = 52;

export const DAY_LENGTH = 180; // seconds at 1x

export const COSTS = {
  hut: { wood: 12 },
  farm: { wood: 6 },
  stockpile: { wood: 8 },
};

export const BUILD_TIME = {
  hut: 8,
  farm: 5,
  stockpile: 6,
};

export const YIELD = {
  tree: { wood: 4 },
  bush: { food: 3 },
  rock: { stone: 3 },
  farm: { food: 5 },
};

export const RECRUIT_COST = { food: 20 };

export const TOOL_HINTS = {
  select: "Кликни по человеку или зданию",
  hut: "Домик для сна — 12 дерева",
  farm: "Грядка даёт еду — 6 дерева",
  stockpile: "Склад хранит запасы — 8 дерева",
  chop: "Отметь дерево на рубку",
  gather: "Отметь куст с ягодами",
  mine: "Отметь камень для добычи",
};

export const TIME_LABELS = [
  [0.0, "Ночь"],
  [0.18, "Рассвет"],
  [0.28, "Утро"],
  [0.45, "День"],
  [0.68, "Вечер"],
  [0.82, "Сумерки"],
  [0.92, "Ночь"],
];
