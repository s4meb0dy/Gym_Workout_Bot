export interface WorkoutExerciseSeed {
  name: string;
  block: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  bodyPart: "upper" | "lower";
  exerciseType?: "reps" | "time" | "warmup";
  progressionMode?: "weight" | "assist";
  progressionStep?: number;
  restTimeInSeconds: number;
  baselineWeightMin?: number;
  baselineWeightMax?: number;
  baselineNote?: string;
  technique?: string;
}

export interface WorkoutDaySeed {
  dayNumber: number;
  weekday: string;
  name: string;
  exercises: WorkoutExerciseSeed[];
}

/** Пріоритетні рухи дня (груди/спина) — потрібне повне відновлення між підходами. */
export const REST_PRIORITY = 150;
/** Важкі базові вправи */
export const REST_HEAVY = 120;
/** Важкі ізольовані тренажери та тяги */
export const REST_MACHINE = 90;
/** Мала ізоляція, плечі та руки */
export const REST_ISOLATION = 60;

export const PROGRAM_VERSION = 11;

/**
 * Блок без ваги: один "підхід"-чекліст. Ваги немає, таймера відпочинку немає,
 * бот показує список і чекає підтвердження.
 */
function checklistBlock(
  name: string,
  block: string,
  bodyPart: "upper" | "lower",
  steps: string[],
): WorkoutExerciseSeed {
  return {
    name,
    block,
    targetSets: 1,
    targetRepsMin: 1,
    targetRepsMax: 1,
    bodyPart,
    exerciseType: "warmup",
    progressionStep: 0,
    restTimeInSeconds: 0,
    technique: steps.join("\n"),
  };
}

/**
 * Розминка v10 — тільки кардіо і підвідні підходи. Мобільність винесено в
 * блок «Постава» в кінці дня: робити окремі вправи після кардіо незручно, а
 * статична розтяжка перед роботою ще й тимчасово знижує силу. Постава ж
 * потребує частоти, а не свіжості, тому кінець тренування для неї — краще місце.
 */
const warmup = (name: string, bodyPart: "upper" | "lower", steps: string[]) =>
  checklistBlock(name, "Розминка", bodyPart, steps);

/**
 * Причина цього блоку — надмірний передній нахил тазу (anterior pelvic tilt) і
 * кіфоз грудного відділу від сидіння. При APT низ живота випирає навіть на
 * низькому відсотку жиру, бо таз тягне передню стінку вперед. Розтяжка згиначів
 * стегна прибирає тягу, dead bug вчить прес тримати таз у нейтралі, а прогин і
 * розтяжка грудних розкривають грудний відділ.
 */
const POSTURE_STEPS = [
  "1) Розтяжка згиначів стегна на коліні — 45 сек на кожну ногу. КЛЮЧОВЕ: підкрути таз (копчик вниз, «підібрати хвіст») і напруж сідницю задньої ноги. Без цього тягнеться поясниця, а не згиначі — і сенсу нуль.",
  "2) Сідничний мостик — 12 повторень, пауза 2 сек зверху зі стиснутою сідницею. Піднімай тазом, не прогинай поясницю: зверху тіло має бути прямою лінією, а не дугою.",
  "3) Dead bug — 8 на сторону. Поясниця притиснута до підлоги ВЕСЬ час, ребра тягни вниз. Це вчить прес тримати таз у нейтралі — саме те, що прибирає випирання низу живота.",
  "4) Прогин грудним відділом через лаву або ролик — 10 повторень, руки за головою, дихай у розтяг.",
  "5) Розтяжка грудних у дверях або на рамі — 30 сек на сторону, лікоть на рівні плеча. Тісні груди тягнуть плечі вперед.",
];

const POSTURE_BLOCK = checklistBlock(
  "Постава — таз і грудний відділ",
  "Постава (у кінці)",
  "upper",
  POSTURE_STEPS,
);

const WARMUP_UPPER_CHEST = warmup("Розминка — верх (груди)", "upper", [
  "1) Кардіо 3–5 хв: велотренажер або дорожка, до легкої задишки.",
  "2) Підвідні в жимі на похилій: 10 кг×10, 14 кг×6, 18 кг×3 — і аж тоді робочі 20 кг.",
  "Мобільність і розтяжка тепер у блоці «Постава» в кінці тренування.",
]);

const WARMUP_LOWER_QUAD = warmup("Розминка — низ (квадрицепс)", "lower", [
  "1) Кардіо 3–5 хв.",
  "2) Присідання з власною вагою — 10, кожне глибше. Займає 30 сек, але коліна і стегна заходять у робочу амплітуду.",
  "3) Підвідні в Goblet: 12 кг×10, 20 кг×8 — і аж тоді робочі 30 кг.",
  "Мобільність і розтяжка — у блоці «Постава» в кінці.",
]);

const WARMUP_UPPER_BACK = warmup("Розминка — верх (спина)", "upper", [
  "1) Кардіо 3–5 хв.",
  "2) Підвідні: підтягування з противагою 18 кг×6, потім 14 кг×4 — і аж тоді перший робочий підхід без противаги.",
  "Мобільність і розтяжка — у блоці «Постава» в кінці.",
]);

const WARMUP_LOWER_POSTERIOR = warmup("Розминка — низ (задня поверхня)", "lower", [
  "1) Кардіо 3–5 хв.",
  "2) Підвідні в румунській тязі: 12 кг×10, 18 кг×8 — і аж тоді робочі 26 кг. На перших підвідних відчуй шарнір у стегні, а не згин спини.",
  "Мобільність і розтяжка — у блоці «Постава» в кінці.",
]);

/**
 * Прес — 3 підходи в КІНЦІ двох днів (Ср + Нд), а не 4×15 на старті кожного дня.
 * Локального жироспалювання не існує, а втомлений кор псує брейс у присіді,
 * румунській тязі та жимах.
 */
const CORE_CABLE_CRUNCH: WorkoutExerciseSeed = {
  name: "Скручування на блоці (Cable Crunch)",
  block: "Прес (у кінці)",
  targetSets: 3,
  targetRepsMin: 15,
  targetRepsMax: 20,
  bodyPart: "upper",
  progressionStep: 2,
  restTimeInSeconds: REST_ISOLATION,
  baselineWeightMin: 45,
  baselineWeightMax: 45,
  baselineNote: "45 кг",
  technique: "Скругли спину, тягни ребрами до таза, без ривків. Прес у кінці — брейс на базі був свіжий.",
};

const CORE_LEG_RAISES: WorkoutExerciseSeed = {
  name: "Прес — підняття ніг на брусях",
  block: "Прес (у кінці)",
  targetSets: 3,
  targetRepsMin: 12,
  targetRepsMax: 15,
  bodyPart: "upper",
  exerciseType: "warmup",
  progressionStep: 0,
  restTimeInSeconds: REST_ISOLATION,
  technique: "Контрольований темп, без розкачування. Прес у кінці дня, а не перед румунською тягою.",
};

export { classifyMuscleGroup } from "../src/services/muscle";

export const workoutProgram: WorkoutDaySeed[] = [
  {
    dayNumber: 1,
    weekday: "Понеділок",
    name: "Верх A (акцент груди)",
    exercises: [
      WARMUP_UPPER_CHEST,
      {
        name: "Жим гантелей на похилій лаві (верх грудей)",
        block: "Гантелі",
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 10,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_PRIORITY,
        baselineWeightMin: 20,
        baselineWeightMax: 20,
        baselineNote: "2×20 кг",
        technique:
          "Лава 30°. ПЕРШИЙ рух дня — груди отримують максимально свіже навантаження. Опускай до легкого розтягу, без відбиву.",
      },
      {
        name: "Тяга гантелі до пояса в нахилі (однією рукою з упором)",
        block: "Гантелі",
        targetSets: 4,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 26,
        baselineWeightMax: 26,
        baselineNote: "26 кг",
        technique: "Тягни лопаткою, не рукою. Пауза 1 сек у верхній точці.",
      },
      {
        name: "Жим гантелей лежачи (горизонтальна лава)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 22,
        baselineWeightMax: 22,
        baselineNote: "2×22 кг",
        technique: "Другий жим дня — добиваємо середину та низ грудей.",
      },
      {
        name: "Тяга верхнього блоку до грудей широким хватом",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_MACHINE,
        baselineWeightMin: 52,
        baselineWeightMax: 52,
        baselineNote: "52 кг",
        technique: "Широкий хват, тягни до верху грудей, лікті вниз — ширина спини.",
      },
      {
        name: "Махи гантелей в сторони (Lateral Raises)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 8,
        baselineWeightMax: 8,
        baselineNote: "2×8 кг",
        technique: "Середня дельта створює ширину плечей — окремий вертикальний жим не потрібен.",
      },
      {
        name: "Канатні розгинання на трицепс у кросовері",
        block: "Тренажери",
        targetSets: 2,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 23,
        baselineWeightMax: 23,
        baselineNote: "23 кг",
        technique: "Підтримуючий об'єм: 2 підходи. Руки вже розвинені, енергія йде на груди/спину.",
      },
      POSTURE_BLOCK,
    ],
  },
  {
    dayNumber: 2,
    weekday: "Середа",
    name: "Низ A (квадрицепс)",
    exercises: [
      WARMUP_LOWER_QUAD,
      {
        name: "Goblet Squats (присідання з гантеллю перед грудьми)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 30,
        baselineWeightMax: 30,
        baselineNote: "30 кг",
        technique: "Кор свіжий — тримай жорсткий брейс. Прес перенесено в кінець тренування.",
      },
      {
        name: "Жим ногами в тренажері (Leg Press)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 10,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 5,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 113,
        baselineWeightMax: 113,
        baselineNote: "113 кг",
        technique: "Стопи на ширині плечей, не розгинай коліна до кінця.",
      },
      {
        name: "Згинання ніг лежачи / сидячи (Leg Curls)",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_MACHINE,
        baselineWeightMin: 41,
        baselineWeightMax: 41,
        baselineNote: "41 кг",
      },
      {
        name: "Підйоми на носки стоячи (Standing Calf Raises)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 12,
        targetRepsMax: 20,
        bodyPart: "lower",
        progressionStep: 5,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 70,
        baselineWeightMax: 70,
        baselineNote: "70 кг",
        technique: "Повна амплітуда: глибоко вниз, максимально вгору, пауза зверху.",
      },
      CORE_CABLE_CRUNCH,
      POSTURE_BLOCK,
    ],
  },
  {
    dayNumber: 3,
    weekday: "П'ятниця",
    name: "Верх B (акцент спина)",
    exercises: [
      WARMUP_UPPER_BACK,
      {
        name: "Підтягування в Гравітоні широким хватом",
        block: "Гравітрон (Турнік)",
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 10,
        bodyPart: "upper",
        progressionMode: "assist",
        progressionStep: 2,
        restTimeInSeconds: REST_PRIORITY,
        baselineWeightMin: 9,
        baselineWeightMax: 9,
        baselineNote: "противага 9 кг (1-й підхід без)",
        technique:
          "ПЕРШИЙ рух дня — спина свіжа. Долонями від себе, акцент на зведенні лопаток. Коли зробиш 4×10 — мінус 2 кг противаги.",
      },
      {
        name: "Віджимання на брусях у Гравітоні",
        block: "Гравітрон (Бруси)",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionMode: "assist",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 4.5,
        baselineWeightMax: 4.5,
        baselineNote: "противага 4.5 кг (1-й підхід без)",
        technique: "Корпус нахилений вперед 15–20°, лікті під 45° — акцент на груди, а не трицепс.",
      },
      {
        name: "Горизонтальна тяга в блоці сидячи (вузький хват)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 10,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 39,
        baselineWeightMax: 39,
        baselineNote: "39 кг",
        technique: "Спина пряма, тягни лопатками, не корпусом. Пауза 1 сек біля корпусу — товщина спини.",
      },
      {
        name: "Зведення рук у кросовері (Cable Fly)",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 10,
        baselineWeightMax: 10,
        baselineNote: "10 кг на сторону",
        technique:
          "Чиста ізоляція грудей без трицепса — дешева по відновленню, тому працює навіть у дефіциті.",
      },
      {
        name: "Махи гантелей у нахилі (задня дельта)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 8,
        baselineWeightMax: 8,
        baselineNote: "2×8 кг",
      },
      {
        name: "Молоткові підйоми (Hammer Curls)",
        block: "Гантелі",
        targetSets: 2,
        targetRepsMin: 10,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 14,
        baselineWeightMax: 14,
        baselineNote: "2×14 кг",
        technique: "Підтримуючий об'єм: 2 підходи.",
      },
      POSTURE_BLOCK,
    ],
  },
  {
    dayNumber: 4,
    weekday: "Неділя",
    name: "Низ B (задня поверхня та сідниці)",
    exercises: [
      WARMUP_LOWER_POSTERIOR,
      {
        name: "Румунська тяга з гантелями",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 26,
        baselineWeightMax: 26,
        baselineNote: "2×26 кг",
        technique:
          "Спина нейтральна, таз назад. Кор свіжий — саме тому прес перенесено в кінець дня.",
      },
      {
        name: "Розгинання ніг сидячи (Leg Extensions)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_MACHINE,
        baselineWeightMin: 73,
        baselineWeightMax: 73,
        baselineNote: "73 кг",
      },
      {
        name: "Підйоми на носки в жимі ногами (Leg Press Calf Raises)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 12,
        targetRepsMax: 20,
        bodyPart: "lower",
        progressionStep: 5,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 79,
        baselineWeightMax: 79,
        baselineNote: "79 кг",
        technique: "Носки на нижньому краю платформи, коліна злегка зігнуті, повна амплітуда.",
      },
      {
        name: "Прогулянка фермера з гантелями",
        block: "Функціонал",
        targetSets: 2,
        targetRepsMin: 45,
        targetRepsMax: 45,
        bodyPart: "upper",
        exerciseType: "time",
        progressionStep: 2,
        restTimeInSeconds: REST_MACHINE,
        baselineWeightMin: 30,
        baselineWeightMax: 30,
        baselineNote: "2×30 кг",
        technique: "45 сек на підхід. Антиротаційний кор без згинання спини.",
      },
      CORE_LEG_RAISES,
      POSTURE_BLOCK,
    ],
  },
];
