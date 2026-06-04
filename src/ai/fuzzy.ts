import {
  FuzzyAND,
  FuzzyOR,
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
 * Three inputs drive two crisp desirability scores (0–100):
 *   - `DistToGoal` (0..30): how far the ball is from the opponent's goal.
 *   - `Pressure` (0..1): how closely the nearest opponent is marking.
 *   - `CentralPos` (0..1): how central the player is laterally (1 = dead central,
 *     0 = on the byline). A central shot angle is far more threatening than one
 *     taken from the wing, so this third input captures the geometry the first two
 *     cannot express.
 *
 * `FuzzyOR` is used where either condition alone is enough to justify passing
 * (e.g. far away *or* on the wing), avoiding over-shooting from hopeless angles.
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

// ---- input: lateral centrality (0..1); 1 = dead central, 0 = on the wing ----
const centralPos = new FuzzyVariable();
const posWide = new LeftShoulderFuzzySet(0, 0.2, 0.5);
const posCentral = new RightShoulderFuzzySet(0.3, 0.6, 1.0);
centralPos.add(posWide);
centralPos.add(posCentral);
fm.addFLV('CentralPos', centralPos);

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

// ---- shoot rules ----
// Close + central + no pressure: the dream scenario — pull the trigger immediately.
fm.addRule(new FuzzyRule(new FuzzyAND(targetClose, posCentral, pressureLow), shootVeryDesirable));
// Close but wide or under pressure: still worth attempting but less ideal.
fm.addRule(new FuzzyRule(new FuzzyAND(targetClose, pressureHigh), shootDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(targetClose, posWide, pressureLow), shootDesirable));
// Medium range: only consider shooting if central and unmarked.
fm.addRule(new FuzzyRule(new FuzzyAND(targetMedium, posCentral, pressureLow), shootDesirable));
// Wide or under pressure at medium range: not worth it.
fm.addRule(new FuzzyRule(new FuzzyAND(targetMedium, new FuzzyOR(posWide, pressureHigh)), shootUndesirable));
// Far: never shoot (unless aiCarry overrides with a pot-shot roll).
fm.addRule(new FuzzyRule(targetFar, shootUndesirable));

// ---- pass rules ----
// FuzzyOR: pressure OR far/wide position both independently justify passing.
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetFar), passVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetMedium), passVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureHigh, targetClose), passDesirable));
// Wide + far: doubly hopeless shot angle — strongly prefer to recycle.
fm.addRule(new FuzzyRule(new FuzzyAND(posWide, new FuzzyOR(targetFar, targetMedium)), passVeryDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(posWide, targetClose), passDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetFar), passDesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetMedium, posCentral), passUndesirable));
fm.addRule(new FuzzyRule(new FuzzyAND(pressureLow, targetClose, posCentral), passUndesirable));

export interface CarrierDesire {
  shoot: number;
  pass: number;
}

/**
 * Evaluates carrier desirabilities for a given distance-to-goal, pressure and
 * lateral centrality.
 * @param distToGoal  world-unit distance from ball to opponent goal line (0..30)
 * @param pressure01  marking pressure normalised to 0..1
 * @param central01   lateral centrality of the ball position (0 = wide, 1 = central)
 */
export function evaluateCarrier(distToGoal: number, pressure01: number, central01: number): CarrierDesire {
  fm.fuzzify('DistToGoal', distToGoal);
  fm.fuzzify('Pressure', pressure01);
  fm.fuzzify('CentralPos', central01);
  return {
    shoot: fm.defuzzify('Shootability'),
    pass: fm.defuzzify('Passability'),
  };
}
