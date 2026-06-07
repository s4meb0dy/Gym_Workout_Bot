UPDATE Exercise
SET
  name = 'Ягодичний міст з гантеллю (Hip Thrust)',
  block = 'Гантелі',
  targetSets = 3,
  targetRepsMin = 12,
  targetRepsMax = 15,
  progressionStep = 2,
  restTimeInSeconds = 120,
  baselineWeightMin = 20,
  baselineWeightMax = 20,
  baselineNote = '20 кг',
  technique = 'Спина на лаві до лопаток, гантель на стегнах, повне розгинання тазу з паузою 1 с зверху',
  muscleGroup = 'Сідниці'
WHERE workoutDayId = (SELECT id FROM WorkoutDay WHERE dayNumber = 4)
  AND name LIKE '%носки%';
SELECT d.weekday || ': ' || e.name FROM Exercise e
JOIN WorkoutDay d ON e.workoutDayId = d.id
WHERE d.dayNumber = 4 ORDER BY e.orderIndex;
