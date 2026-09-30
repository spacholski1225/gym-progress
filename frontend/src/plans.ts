export type TrainingPlanId = 'A' | 'B' | 'C';
export type TrainingPlan = {
  id: TrainingPlanId;
  title: string;
  status: 'ready' | 'pending';
  description: string;
};

export const trainingPlans: TrainingPlan[] = [
  { id: 'A', title: 'Plan nogi', status: 'ready', description: 'Plan A: trening ukierunkowany na nogi.' },
  { id: 'B', title: 'Plan B', status: 'pending', description: 'Zawartość planu jest jeszcze w przygotowaniu.' },
  { id: 'C', title: 'Plan C', status: 'pending', description: 'Zawartość planu jest jeszcze w przygotowaniu.' },
];
