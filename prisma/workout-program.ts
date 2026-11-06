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

export const PROGRAM_VERSION = 16;

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
 * Розминка — тільки кардіо і підвідні підходи: статична розтяжка перед роботою
 * тимчасово знижує силу, а постава потребує частоти, а не свіжості, тому вона в кінці.
 */
const warmup = (name: string, bodyPart: "upper" | "lower", steps: string[]) =>
  checklistBlock(name, "Розминка", bodyPart, steps);

/**
 * Причина цього блоку — надмірний передній нахил тазу (anterior pelvic tilt):
 * при ньому низ живота випирає навіть на низькому відсотку жиру. Розтяжка
 * згиначів стегна знімає тягу тазу вперед від сидіння, мостик вмикає сідниці
 * (вони тримають таз ззаду), dead bug вчить прес тримати таз у нейтралі.
 */
const POSTURE_STEPS = [
  "1) Розтяжка згиначів стегна — 45 сек на кожну ногу. " +
    "Стань на одне коліно (під нього рушник), друга нога попереду, обидва коліна під 90°, корпус рівно, руки на поясі. " +
    "ГОЛОВНЕ: підкрути таз — копчик униз, ніби «підібрати хвіст», — і сильно стисни сідницю ноги, що на коліні. " +
    "Вже від цього спереду стегна біля паху має з'явитися розтяг. Далі, не втрачаючи підкрутки, подай таз уперед на 2–5 см " +
    "і підніми руку з боку коліна вгору. Тягне в попереку — значить, таз «відпустив»: підкрути сильніше й менше подавайся вперед.",
  "2) Сідничний мостик — 12 повторень, пауза 2 сек зверху зі стиснутою сідницею. Піднімай тазом, не прогинай поясницю: зверху тіло має бути прямою лінією, а не дугою.",
  "3) Dead bug — 8 на сторону. Поясниця притиснута до підлоги ВЕСЬ час, ребра тягни вниз. Це вчить прес тримати таз у нейтралі — саме те, що прибирає випирання низу живота.",
];

export const POSTURE_NAME = "Постава — таз і кор";

const POSTURE_BLOCK = checklistBlock(POSTURE_NAME, "Постава (у кінці)", "upper", POSTURE_STEPS);

const WARMUP_UPPER_CHEST = warmup("Розминка — верх (груди)", "upper", [
  "1) Кардіо 3–5 хв: велотренажер або дорожка, до легкої задишки.",
  "2) Підвідні в сміті на похилій: порожній гриф×10, ~30 кг×6, ~36 кг×3 — і аж тоді робочі підходи.",
]);

const WARMUP_LOWER_QUAD = warmup("Розминка — низ (квадрицепс)", "lower", [
  "1) Кардіо 3–5 хв.",
  "2) Присідання з власною вагою — 10, кожне глибше. Займає 30 сек, але коліна і стегна заходять у робочу амплітуду.",
  "3) Підвідні в сміті: порожній гриф×10, ~30 кг×6 — і аж тоді робочі підходи.",
]);

const WARMUP_UPPER_BACK = warmup("Розминка — верх (спина)", "upper", [
  "1) Кардіо 3–5 хв.",
  "2) Підвідні: підтягування з противагою ~18 кг×6, потім ~9 кг×4 — і аж тоді робочі підходи з власною вагою.",
]);

const WARMUP_LOWER_POSTERIOR = warmup("Розминка — низ (задня поверхня)", "lower", [
  "1) Кардіо 3–5 хв.",
  "2) Підвідні в румунській тязі: порожній гриф×10, ~40 кг×6 — і аж тоді робочі підходи. На перших підвідних відчуй шарнір у стегні, а не згин спини.",
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
        name: "Жим на похилій лаві в сміті (верх грудей)",
        block: "Тренажери",
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 10,
        bodyPart: "upper",
        progressionStep: 2.5,
        restTimeInSeconds: REST_PRIORITY,
        baselineWeightMin: 46,
        baselineWeightMax: 46,
        baselineNote: "46 кг на грифі",
        technique:
          "Лава 30° у сміті — важкі гантелі вже не закинути. ПЕРШИЙ рух дня. Опускай до легкого розтягу, без відбиву. " +
          "Завжди виставляй страхувальні упори трохи нижче грудей.",
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
        targetRepsMax: 20,
        bodyPart: "upper",
        progressionStep: 1,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 8,
        baselineWeightMax: 8,
        baselineNote: "2×8 кг",
        technique:
          "Середня дельта створює ширину плечей. Прогресія спершу повторами: коли всі підходи по 20 — бери +1 кг " +
          "(+2 кг до 8-кілограмових гантелей — це +25%, такий стрибок не виходить).",
      },
      {
        name: "Канатні розгинання на трицепс у кросовері",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 23,
        baselineWeightMax: 23,
        baselineNote: "23 кг",
        technique: "3 підходи: трицепс — половина об'єму руки, а жими після травми ребра ще не добирають навантаження.",
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
        name: "Присідання в сміті",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2.5,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 40,
        baselineWeightMax: 40,
        baselineNote: "40 кг на грифі",
        technique:
          "Заміна гоблету: той упирався в найважчу гантель (30 кг). Ступні трохи попереду грифа, глибина — " +
          "стегна паралельно підлозі або нижче, жорсткий брейс. Страхувальні упори — трохи нижче нижньої точки.",
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
        name: "Жим гантелей на похилій лаві (30°)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 18,
        baselineWeightMax: 18,
        baselineNote: "2×18 кг (≈80% від жиму лежачи)",
        technique:
          "Друга сесія верху грудей на тиждень: важкий сміт у понеділок, тут — об'єм і глибше розтягнення. " +
          "Закидання: сядь, постав гантелі торцем на стегна біля колін, лягай і по черзі підштовхни їх коліньми вгору. " +
          "Опускай до розтягу на рівні грудей, лікті під 45°. Якщо закидати важко — бери на 2 кг менше: " +
          "для 8–12 повторень вага не головне. Перший тиждень після хвороби — запас 2–3 повтори.",
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
        name: "Зведення в кросовері знизу вгору (верх грудей)",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 15,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 7,
        baselineWeightMax: 7,
        baselineNote: "~7 кг на сторону (легше за звичайне зведення)",
        technique:
          "Блоки в найнижчій точці, крок уперед, руки трохи зігнуті. Зводь знизу вгору до рівня підборіддя — " +
          "це верх грудей. Пауза 1 сек, долоні майже торкаються. Ізоляція без трицепса, дешева по відновленню.",
      },
      {
        name: "Махи гантелей у нахилі (задня дельта)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 20,
        bodyPart: "upper",
        progressionStep: 1,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 8,
        baselineWeightMax: 8,
        baselineNote: "2×8 кг",
        technique: "Суперсет з махами в сторони на блоці: по підходу кожної без відпочинку, потім 60 с — економить ~5 хв.",
      },
      {
        name: "Махи в сторони на блоці (кросовер)",
        block: "Тренажери",
        targetSets: 3,
        targetRepsMin: 12,
        targetRepsMax: 20,
        bodyPart: "upper",
        progressionStep: 1,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 5,
        baselineWeightMax: 5,
        baselineNote: "5 кг на блоці",
        technique:
          "Друга сесія середньої дельти на тиждень — ширина плечей. Блок дає навантаження і внизу амплітуди, " +
          "на відміну від гантелей. Однією рукою, корпус трохи від блоку. Суперсет із задньою дельтою. " +
          "Прогресія повторами до 20, тоді +1 крок блоку.",
      },
      {
        name: "Молоткові підйоми (Hammer Curls)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 10,
        targetRepsMax: 12,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_ISOLATION,
        baselineWeightMin: 14,
        baselineWeightMax: 14,
        baselineNote: "2×14 кг",
        technique:
          "3 підходи — біцепс і брахіораліс для товщини руки. Трицепс сьогодні вже отримав роботу в жимі й брусах.",
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
        name: "Румунська тяга зі штангою",
        block: "Штанга",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2.5,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 60,
        baselineWeightMax: 60,
        baselineNote: "60 кг",
        technique:
          "Заміна гантелей (2×28 кг упирались у хват). Спина нейтральна, таз назад, гриф ковзає по стегнах. " +
          "Кистьові лямки, якщо хват здається раніше за задню поверхню.",
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
