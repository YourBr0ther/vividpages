import { z } from 'zod';

export const TIME_OF_DAY = ['morning', 'afternoon', 'evening', 'night', 'ambiguous'] as const;
export type TimeOfDay = (typeof TIME_OF_DAY)[number];

export const SCENE_TYPES = [
  'narrative',
  'dialogue',
  'action',
  'description',
  'transition',
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

/** Max characters the model may report per scene. */
export const MAX_SCENE_CHARACTERS = 12;

export const sceneCharacterAnalysisSchema = z.object({
  /** Roster-resolved character name (or the new character's name). */
  name: z.string().min(1),
  /** True ONLY for characters not already in the roster. */
  isNew: z.boolean(),
  /** New visual/physical details introduced in this scene; null when none. */
  descriptionDelta: z.string().nullable().default(null),
  /** Outfit/injury/emotional-state changes in this scene; null when none. */
  stateChanges: z.string().nullable().default(null),
});

export const sceneAnalysisSchema = z.object({
  /** <= ~70 words; enforced loosely via a character cap. */
  summary: z.string().min(1).max(600),
  /** Short location/environment phrase. */
  setting: z.string().min(1),
  timeOfDay: z.enum(TIME_OF_DAY),
  /** 1-4 words. */
  mood: z.string().min(1),
  sceneType: z.enum(SCENE_TYPES),
  /** One filmable sentence. */
  keyVisualMoment: z.string().min(1),
  characters: z.array(sceneCharacterAnalysisSchema).max(MAX_SCENE_CHARACTERS),
});

export type SceneCharacterAnalysis = z.infer<typeof sceneCharacterAnalysisSchema>;
export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;
