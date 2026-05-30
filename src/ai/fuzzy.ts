import {
  FuzzyAND,
  FuzzyModule,
  FuzzyRule,
  FuzzyVariable,
  LeftShoulderFuzzySet,
  RightShoulderFuzzySet,
  TriangularFuzzySet,
} from 'yuka';

/**
 * Fuzzy-logic arbitration for the ball carrier — the technique Buckland uses in
 * *Programming Game AI by Example*, here implemented with Yuka's `FuzzyModule`.
 *
 * Two inputs (distance to goal, marking pressure) drive two crisp desirability
 * scores (0–100): how appealing it is to shoot vs. to pass. The carrier brain
 * combines these with the hard feasibility gates (`canShoot`, `findBestPass`)
 * so decisions stay both smart and legal.
 */

const fm = new FuzzyModule();

// ---- input: distance to goal (0..30 world units) ----
const distGoal = new FuzzyVariable();
const targetClose = new LeftShoulderFuzzySet(0, 6, 12);
const targetMedium = new TriangularFuzzySet(6, 12, 20);
const targetFar = new RightShoulderFuzzySet(12, 20, 30);
distGoal.add(targetClose);
distGoal.add(targetMedium);
distGoal.add(targetFar);
fm.addFLV('DistToGoal', distGoal);

// ---- input: marking pressure (0..1) ----
const pressure = new FuzzyVariable();
const pressureLow = new LeftShoulderFuzzySet(0, 0.25, 0.6);
const pressureHigh = new RightShoulderFuzzySet(0.25, 0.6, 1);
pressure.add(pressureLow);
pressure.add(pressureHigh);
fm.addFLV('Pressure', pressure);

// ---- output: shoot desirability (0..100) ----
const shoot = new FuzzyVariable();
const shootUndesirable = new LeftShoulderFuzzySet(0, 25, 50);
const shootDesirable = new TriangularFuzzySet(25, 50, 75);
const shootVeryDesirable = new RightShoulderFuzzySet(50, 75, 100);
shoot.add(shootUndesirable);
shoot.add(shootDesirable);
shoot.add(shootVeryDesirable);
fm.addFLV('Shootability', shoot);

// ---- output: pass desirability (0..100) ----
const pass = new FuzzyVariable();
const passUndesirable = new LeftShoulderFuzzySet(0, 25, 50);
const passDesirable = new TriangularFuzzySet(25, 50, 75);
const passVeryDesirable = new RightShoulderFuzzySet(50, 75, 100);
pass.add(passUndesirable);
pass.add(passDesirable);
pass.add(passVeryDesirable);
fm.addFLV('Passability', pass);

// ---- shoot rules: close & unmarked is golden; far is hopeless ----
fm.addRule(new FuzzyRule(new FuzzyAND(targetClose, pressureLow), shootVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(targetClose, pressureHigh), shootDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(targetMedium, pressureLow), shootDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(targetMedium, pressureHigh), shootUndesirable));
fm.addRule(new FuzzyRule(targetFar, shootUndesirable));

// ---- pass rules: pass under pressure or when too far to threaten ----
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetFar), passVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetMedium), passVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetClose), passDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetFar), passDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetMedium), passUndesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetClose), passUndesirable));

export interface CarrierDesire {
  shoot: number;
  pass: number;
}

/**
 * Evaluates carrier desirabilities for a given distance-to-goal and pressure.
 * @param distToGoal world-unit distance from ball to opponent goal line
 * @param pressure01 marking pressure normalised to 0..1
 */
export function evaluateCarrier(distToGoal: number, pressure01: number): CarrierDesire {
  fm.fuzzify('DistToGoal', distToGoal);
  fm.fuzzify('Pressure', pressure01);
  return {
    shoot: fm.defuzzify('Shootability'),
    pass: fm.defuzzify('Passability'),
  };
}
