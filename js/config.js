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
  select: "Кликни по человеку, зверю или зданию",
  hut: "Домик для сна — 12 дерева",
  farm: "Грядка даёт еду — 6 дерева",
  stockpile: "Склад хранит запасы — 8 дерева",
  chop: "Отметь дерево на рубку",
  gather: "Отметь куст с ягодами",
  mine: "Отметь камень для добычи",
  paint_grass: "Кисть: трава",
  paint_sand: "Кисть: песок",
  paint_dirt: "Кисть: земля",
  paint_water: "Кисть: вода",
  paint_snow: "Кисть: снег",
  paint_lava: "Кисть: лава",
  paint_mountain: "Кисть: горы",
  plant_tree: "Посадить деревья",
  plant_bush: "Посадить ягоды",
  plant_rock: "Положить камни",
  erase: "Стереть клетку в землю",
  spawn_human: "Призвать человека (бесплатно)",
  spawn_rabbit: "Призвать кролика",
  spawn_wolf: "Призвать волка",
  spawn_bandit: "Призвать бандита",
  rain: "Дождь: тушит огонь, растит еду",
  bless: "Благословение: еда и силы",
  lightning: "Молния",
  meteor: "Метеорит",
  fire: "Поджечь мир",
  bomb: "Взрыв",
  tornado: "Торнадо",
  death: "Стереть жизнь",
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
