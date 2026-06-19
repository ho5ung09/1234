export type TrashType = 'plastic_bottle' | 'aluminum_can' | 'nylon_net' | 'pesticide_can' | 'tire';

export interface Trash {
  id: string;
  x: number;
  y: number;
  type: TrashType;
  scanned: boolean;
  scanProgress: number; // 0 to 1
  size: number;
  label: string;
  points: number;
  color: string;
}

export type MarineLifeType = 'clownfish' | 'turtle' | 'dolphin' | 'ray' | 'jellyfish';

export interface MarineLife {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: MarineLifeType;
  name: string;
  size: number;
  speed: number;
  angle: number;
  color: string;
  bubbleTimer: number;
}

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  cost: number;
  level: number;
  maxLevel: number;
  multiplier: number;
}

export interface GameStats {
  score: number;
  credits: number;
  oilSpillCleared: number;
  trashRecycled: number;
  marineLifeInjuries: number;
  totalRuns: number;
}

export interface AiLog {
  timestamp: string;
  type: 'info' | 'warning' | 'success' | 'ai';
  message: string;
}

export interface GeminiAnalysis {
  title: string;
  environmentalImpact: string;
  speciesProtected: string;
  roboticUpgradeSuggestions: string[];
  kudos: string;
  facts: string;
}
