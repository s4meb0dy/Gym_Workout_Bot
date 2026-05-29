/**
 * Визначає основну м'язову групу за назвою вправи.
 * Порядок правил важливий: специфічні (ноги/прес/спина/руки) перевіряються
 * перед загальним "жим", щоб уникнути хибної класифікації.
 */
export function classifyMuscleGroup(name: string, exerciseType?: string): string {
  const n = name.toLowerCase();

  if (exerciseType === "warmup") return "Прес/Кор";
  if (n.includes("фермер") || n.includes("farmer")) return "Функціонал";
  if (n.includes("носки") || n.includes("calf")) return "Литки";
  if (n.includes("румунськ")) return "Біцепс стегна";
  if (n.includes("розгинання ніг") || n.includes("leg extension")) return "Квадрицепс";
  if (n.includes("згинання ніг") || n.includes("leg curl")) return "Біцепс стегна";
  if (
    n.includes("присід") ||
    n.includes("goblet") ||
    n.includes("squat") ||
    n.includes("жим ногами") ||
    n.includes("leg press") ||
    n.includes("ногами")
  ) {
    return "Квадрицепс";
  }
  if (n.includes("скручування") || n.includes("crunch") || n.includes("прес") || n.includes("підняття ніг")) {
    return "Прес/Кор";
  }
  if (n.includes("підтягув")) return "Спина";
  if (n.includes("тяга") || n.includes("верхнього блоку")) return "Спина";
  if (n.includes("віджимання") || n.includes("брус")) return "Груди";
  if (n.includes("махи")) return "Плечі";
  if (n.includes("молотков") || n.includes("hammer")) return "Біцепс";
  if (n.includes("біцепс")) return "Біцепс";
  if (
    n.includes("французьк") ||
    n.includes("kickback") ||
    n.includes("розгинання рук") ||
    n.includes("канатні розгинання") ||
    n.includes("трицепс")
  ) {
    return "Трицепс";
  }
  if (n.includes("жим")) {
    if (n.includes("сидячи") || n.includes("вертикальн") || n.includes("плеч")) return "Плечі";
    return "Груди";
  }
  return "Інше";
}
