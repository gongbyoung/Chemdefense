import { ElementData, CompoundData, Stage, Reaction } from './types';
import reactionsData from './data/reactions.json';
import elementsData from './data/elements.json';
import elementsBaseData from './data/elements_base.json';
import compoundsData from './data/compounds.json';
import tutorialStagesData from './data/tutorial_stages.json';

export const REACTIONS: Reaction[] = reactionsData as Reaction[];
export const TUTORIAL_STAGES: Stage[] = tutorialStagesData as Stage[];

export const ELEMENTS: Record<string, ElementData> = Object.keys(elementsBaseData).reduce((acc, key) => {
  const base = (elementsBaseData as any)[key];
  const stats = (elementsData as any)[key];
  acc[key] = { ...base, ...stats };
  return acc;
}, {} as Record<string, ElementData>);

export const COMPOUNDS: Record<string, CompoundData> = compoundsData as Record<string, CompoundData>;
