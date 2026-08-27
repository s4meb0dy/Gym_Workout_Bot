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

export const PROGRAM_VERSION = 8;

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
  baselineWeightMin: 25,
  baselineWeightMax: 25,
  baselineNote: "25 кг",
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
      {
        name: "Жим гантелей на похилій лаві (верх грудей)",
        block: "Гантелі",
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 10,
        bodyPart: "upper",
        progressionStep: 2,
        restTimeInSeconds: REST_PRIORITY,
        baselineWeightMin: 12,
        baselineWeightMax: 14,
        baselineNote: "2×12–14 кг",
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
        baselineWeightMin: 14,
        baselineWeightMax: 16,
        baselineNote: "14–16 кг",
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
        baselineWeightMin: 14,
        baselineWeightMax: 14,
        baselineNote: "2×14 кг",
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
        baselineWeightMin: 39,
        baselineWeightMax: 39,
        baselineNote: "39 кг",
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
        baselineWeightMin: 6,
        baselineWeightMax: 6,
        baselineNote: "2×6 кг",
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
    ],
  },
  {
    dayNumber: 2,
    weekday: "Середа",
    name: "Низ A (квадрицепс)",
    exercises: [
      {
        name: "Goblet Squats (присідання з гантеллю перед грудьми)",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 20,
        baselineWeightMax: 20,
        baselineNote: "20 кг",
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
        baselineWeightMin: 80,
        baselineWeightMax: 80,
        baselineNote: "80 кг",
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
        baselineWeightMin: 32,
        baselineWeightMax: 32,
        baselineNote: "32 кг",
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
        baselineWeightMin: 50,
        baselineWeightMax: 50,
        baselineNote: "50 кг",
        technique: "Повна амплітуда: глибоко вниз, максимально вгору, пауза зверху.",
      },
      CORE_CABLE_CRUNCH,
    ],
  },
  {
    dayNumber: 3,
    weekday: "П'ятниця",
    name: "Верх B (акцент спина)",
    exercises: [
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
        baselineWeightMin: 23,
        baselineWeightMax: 23,
        baselineNote: "противага 23 кг",
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
        baselineWeightMin: 23,
        baselineWeightMax: 23,
        baselineNote: "противага 23 кг",
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
        baselineWeightMin: 6,
        baselineWeightMax: 6,
        baselineNote: "2×6 кг",
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
        baselineWeightMin: 10,
        baselineWeightMax: 10,
        baselineNote: "2×10 кг",
        technique: "Підтримуючий об'єм: 2 підходи.",
      },
    ],
  },
  {
    dayNumber: 4,
    weekday: "Неділя",
    name: "Низ B (задня поверхня та сідниці)",
    exercises: [
      {
        name: "Румунська тяга з гантелями",
        block: "Гантелі",
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        bodyPart: "lower",
        progressionStep: 2,
        restTimeInSeconds: REST_HEAVY,
        baselineWeightMin: 14,
        baselineWeightMax: 16,
        baselineNote: "2×14–16 кг",
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
        baselineWeightMin: 90,
        baselineWeightMax: 90,
        baselineNote: "90 кг",
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
        baselineWeightMin: 20,
        baselineWeightMax: 20,
        baselineNote: "2×20 кг",
        technique: "45 сек на підхід. Антиротаційний кор без згинання спини.",
      },
      CORE_LEG_RAISES,
    ],
  },
];
