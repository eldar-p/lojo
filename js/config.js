export const TILE = 28;

export const MAP_W = 72;
export const MAP_H = 52;

export const DAY_LENGTH = 180; // seconds at 1x

export const COSTS = {
  hut: { wood: 12 },
  farm: { wood: 6 },
  stockpile: { wood: 8 },
  wall: { wood: 2, stone: 3 },
  gate: { wood: 6, stone: 2 },
  tower: { wood: 10, stone: 8 },
  barracks: { wood: 16, stone: 10 },
};

export const BUILD_TIME = {
  hut: 8,
  farm: 5,
  stockpile: 6,
  wall: 4,
  gate: 6,
  tower: 10,
  barracks: 12,
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
  wall: "Стена — 2 дерева, 3 камня",
  gate: "Ворота (проход) — 6 дерева, 2 камня",
  tower: "Башня стреляет по врагам — 10 дерева, 8 камня",
  barracks: "Казарма: готовит солдат — 16 дерева, 10 камня",
  stance_defend: "Доктрина: оборона стен",
  stance_raid: "Доктрина: рейды по тылам",
  stance_encircle: "Доктрина: охват с флангов",
  stance_siege: "Доктрина: осада укреплений",
  stance_breakthrough: "Доктрина: прорыв слабого места",
  stance_ambush: "Доктрина: засада у леса",
  declare_war: "Объявить войну Орде",
  make_peace: "Заключить мир",
  spawn_army: "Призвать волну врагов",
  train_soldier: "Обучить солдата (12 еды, 4 дерева)",
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
