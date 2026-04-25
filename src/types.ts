export interface ElementData {
  name: string;
  elementName: string;
  atomicNumber: number;
  valenceElectrons: number;
  groupType: string;
  reactionType: string;
  baseDmg: number;
  range: number;
  fireRate: number;
  isPlayable: boolean;
  cost: number;
  type: 'tower' | 'obstacle' | 'equipment';
}

export interface Reaction {
  reactant1: string;
  reactant2: string;
  product: string;
  type: string;
  gold: number;
  description: string;
}

export interface CompoundData {
  id: string;
  name: string;
  displayName: string;
  description: string;
  hazard?: string;
  primaryAtom: string;
  isIonized?: boolean;
  isNeutral?: boolean;
}

export interface Tower {
  id: string;
  x: number;
  y: number;
  element: ElementData;
  lastFired: number;
  level: number;
}

export interface Enemy {
  id: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  bondEnergy: number;
  maxBondEnergy: number;
  speed: number;
  compound: CompoundData;
  path: { x: number; y: number }[];
  pathIndex: number;
  radius: number;
  debuffs: { type: string; duration: number }[];
}

export interface Projectile {
  id: string;
  x: number;
  y: number;
  targetId: string;
  damage: number;
  speed: number;
  element: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  text?: string;
}

export interface Stage {
  id: string;
  title: string;
  caseStudy: string;
  enemyId: string;
  givenTowers: string[];
  unlocks: string; // The element unlocked after this stage
  objective: string;
  reward: string;
  quote: string;
  clearCondition: 'defeat_all' | 'survive_time' | 'reach_gold';
  bgType: 'station' | 'subway' | 'factory' | 'storage' | 'lab';
  sourcePos: { x: number; y: number; type: 'tank' | 'truck' | 'factory' };
}
