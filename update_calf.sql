UPDATE Exercise
SET
  name = 'Підйоми на носки стоячи (Standing Calf Raises)',
  baselineWeightMin = 50,
  baselineWeightMax = 50,
  baselineNote = '50 кг',
  technique = 'Повна амплітуда: глибоко вниз, максимально вгору, пауза зверху',
  muscleGroup = 'Литки'
WHERE name LIKE '%Seated Calf%';
SELECT name FROM Exercise WHERE name LIKE '%Calf%';
