/**
 * Character Service - Character extraction, deduplication, and profile building
 *
 * This service handles:
 * - Extracting character mentions from analyzed scenes
 * - Deduplicating characters (identifying name variations)
 * - Building comprehensive character profiles with detailed appearance data
 * - CRUD operations for characters
 */

import { db } from '../db/index.js';
import { characters, scenes, vividPages, type Character, type NewCharacter, type Scene } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { BaseLLMService } from './llm/BaseLLMService.js';

// ============================================
// Types & Interfaces
// ============================================

export interface CharacterMention {
  sceneId: string;
  sceneNumber: number;
  chapterNumber: number;
  name: string;
  description: string;
}

export interface CharacterGroup {
  primaryName: string;
  aliases: string[];
  mentions: CharacterMention[];
  totalAppearances: number;
}

export interface DetailedCharacterAppearance {
  // Physical Build & Proportions
  height?: string;
  build?: string;
  bodyType?: string;
  bustSize?: string;
  shoulders?: string;

  // Facial Features
  faceShape?: string;
  eyeColor?: string;
  eyeShape?: string;
  eyebrows?: string;
  nose?: string;
  lips?: string;
  jawline?: string;
  cheekbones?: string;

  // Hair
  hairColor?: string;
  hairStyle?: string;
  hairTexture?: string;
  hairLength?: string;
  facialHair?: string;

  // Skin & Complexion
  skinTone?: string;
  ethnicity?: string;
  complexion?: string;

  // Age & Overall Appearance
  age?: string;
  ageAppearance?: string;

  // Distinctive Features
  distinctiveFeatures?: string[];
  tattoos?: string[];
  piercings?: string[];

  // Style & Presentation
  typicalClothing?: string;
  clothingColors?: string[];
  accessories?: string[];
  overallStyle?: string;

  // Posture & Bearing
  posture?: string;
  gait?: string;

  // Voice & Speech
  voice?: string;
  accent?: string;

  // Comprehensive Summaries
  physicalDescription: string;
  visualSummary: string;
}

export interface DeduplicationResult {
  same: boolean;
  confidence: number;
  reasoning: string;
}

// ============================================
// Character Extraction
// ============================================

/**
 * Extract all character mentions from analyzed scenes
 */
export async function extractCharactersFromScenes(vividPageId: string): Promise<CharacterMention[]> {
  console.log(`📖 Extracting characters from scenes for VividPage: ${vividPageId}`);

  // Get all analyzed scenes
  const analyzedScenes = await db.query.scenes.findMany({
    where: and(
      eq(scenes.vividPageId, vividPageId),
      eq(scenes.analysisStatus, 'completed')
    ),
    orderBy: [scenes.sceneIndexGlobal],
  });

  if (analyzedScenes.length === 0) {
    console.log('⚠️  No analyzed scenes found');
    return [];
  }

  console.log(`📊 Found ${analyzedScenes.length} analyzed scenes`);

  const mentions: CharacterMention[] = [];

  for (const scene of analyzedScenes) {
    if (!scene.llmAnalysis || typeof scene.llmAnalysis !== 'object') {
      continue;
    }

    const analysis = scene.llmAnalysis as any;

    if (Array.isArray(analysis.characters)) {
      for (const char of analysis.characters) {
        if (char.name && char.description) {
          mentions.push({
            sceneId: scene.id,
            sceneNumber: scene.sceneNumber,
            chapterNumber: scene.chapterNumber,
            name: char.name.trim(),
            description: char.description.trim(),
          });
        }
      }
    }
  }

  console.log(`✅ Extracted ${mentions.length} character mentions`);
  return mentions;
}

// ============================================
// Character Deduplication
// ============================================

/**
 * Group character mentions by exact name match (case-insensitive)
 */
function groupByExactName(mentions: CharacterMention[]): Map<string, CharacterMention[]> {
  const groups = new Map<string, CharacterMention[]>();

  for (const mention of mentions) {
    const normalizedName = mention.name.toLowerCase();
    const existing = groups.get(normalizedName);

    if (existing) {
      existing.push(mention);
    } else {
      groups.set(normalizedName, [mention]);
    }
  }

  return groups;
}

/**
 * Use LLM to determine if two character groups are the same person
 */
async function areSameCharacter(
  groupA: { name: string; mentions: CharacterMention[] },
  groupB: { name: string; mentions: CharacterMention[] },
  llmService: BaseLLMService
): Promise<DeduplicationResult> {
  const prompt = `Analyze if these are the same character from a book. Consider all available descriptions.

Character A: "${groupA.name}"
Appearances:
${groupA.mentions.slice(0, 5).map((m, i) => `${i + 1}. Scene ${m.chapterNumber}.${m.sceneNumber}: ${m.description}`).join('\n')}
${groupA.mentions.length > 5 ? `... and ${groupA.mentions.length - 5} more appearances` : ''}

Character B: "${groupB.name}"
Appearances:
${groupB.mentions.slice(0, 5).map((m, i) => `${i + 1}. Scene ${m.chapterNumber}.${m.sceneNumber}: ${m.description}`).join('\n')}
${groupB.mentions.length > 5 ? `... and ${groupB.mentions.length - 5} more appearances` : ''}

Analyze if these are the same person. Consider:
- Name similarity (e.g., "Jon" vs "Jon Snow" vs "Lord Snow")
- Physical description consistency
- Context and role in the story

Return ONLY a JSON object:
{
  "same": true or false,
  "confidence": 0.0 to 1.0 (how confident you are),
  "reasoning": "Brief explanation of your decision"
}`;

  try {
    const response = await llmService.generate(prompt, { format: 'json', temperature: 0.3 });
    const result = JSON.parse(response);

    return {
      same: result.same === true,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      reasoning: result.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    console.error('❌ Error in character deduplication:', error);
    return {
      same: false,
      confidence: 0,
      reasoning: 'Error during deduplication',
    };
  }
}

/**
 * Deduplicate character mentions and create character groups
 */
export async function deduplicateCharacters(
  mentions: CharacterMention[],
  llmService: BaseLLMService
): Promise<CharacterGroup[]> {
  console.log(`🔄 Deduplicating ${mentions.length} character mentions...`);

  // Phase 1: Group by exact name
  const exactGroups = groupByExactName(mentions);
  console.log(`📊 Phase 1: ${exactGroups.size} exact name groups`);

  // Convert to array for Phase 2
  const groups: CharacterGroup[] = Array.from(exactGroups.entries()).map(([name, mentions]) => ({
    primaryName: mentions[0].name, // Use original casing from first mention
    aliases: [],
    mentions,
    totalAppearances: mentions.length,
  }));

  // Phase 2: LLM-based deduplication (compare groups pairwise)
  console.log('🤖 Phase 2: LLM-based deduplication...');

  const mergedGroups: CharacterGroup[] = [];
  const processed = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (processed.has(i)) continue;

    const currentGroup = groups[i];
    const aliasesToAdd: string[] = [];

    // Compare with remaining groups
    for (let j = i + 1; j < groups.length; j++) {
      if (processed.has(j)) continue;

      const compareGroup = groups[j];

      // Skip if names are very different (optimization)
      const nameSimilarity = calculateNameSimilarity(currentGroup.primaryName, compareGroup.primaryName);
      if (nameSimilarity < 0.3) continue;

      // Use LLM to determine if same character
      const result = await areSameCharacter(
        { name: currentGroup.primaryName, mentions: currentGroup.mentions },
        { name: compareGroup.primaryName, mentions: compareGroup.mentions },
        llmService
      );

      console.log(
        `  "${currentGroup.primaryName}" vs "${compareGroup.primaryName}": ${result.same ? 'SAME' : 'different'} (confidence: ${result.confidence})`
      );

      // Merge if same with high confidence
      if (result.same && result.confidence > 0.7) {
        aliasesToAdd.push(compareGroup.primaryName);
        currentGroup.mentions.push(...compareGroup.mentions);
        currentGroup.totalAppearances += compareGroup.totalAppearances;
        processed.add(j);
      }
    }

    if (aliasesToAdd.length > 0) {
      currentGroup.aliases = [...new Set(aliasesToAdd)];
    }

    mergedGroups.push(currentGroup);
    processed.add(i);
  }

  console.log(`✅ Deduplication complete: ${mergedGroups.length} unique characters`);
  return mergedGroups;
}

/**
 * Simple name similarity calculation (Levenshtein-like)
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // Check if one name is contained in the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;

  // Check if names share significant words
  const words1 = n1.split(/\s+/);
  const words2 = n2.split(/\s+/);
  const sharedWords = words1.filter(w => words2.includes(w));

  if (sharedWords.length > 0) {
    return sharedWords.length / Math.max(words1.length, words2.length);
  }

  return 0;
}

// ============================================
// Character Profile Building
// ============================================

/**
 * Build detailed character profile from all mentions
 */
export async function buildDetailedCharacterProfile(
  characterGroup: CharacterGroup,
  llmService: BaseLLMService
): Promise<DetailedCharacterAppearance> {
  console.log(`🎨 Building profile for: ${characterGroup.primaryName} (${characterGroup.totalAppearances} appearances)`);

  const prompt = `You are analyzing multiple mentions of a character across different scenes.
Create a COMPREHENSIVE visual profile by synthesizing all descriptions.

Character: ${characterGroup.primaryName}
${characterGroup.aliases.length > 0 ? `Also known as: ${characterGroup.aliases.join(', ')}` : ''}

All Mentions (${characterGroup.totalAppearances} total):
${characterGroup.mentions.slice(0, 10).map((m, i) => `${i + 1}. Scene ${m.chapterNumber}.${m.sceneNumber}: ${m.description}`).join('\n\n')}
${characterGroup.mentions.length > 10 ? `\n... and ${characterGroup.mentions.length - 10} more appearances` : ''}

Extract and synthesize into a detailed JSON profile with the following structure.
Use "not specified" for details not mentioned in the text.

{
  "height": "specific measurement or relative (tall/short/average)",
  "build": "body type (athletic/slender/muscular/heavyset/etc)",
  "bodyType": "overall physique",
  "bustSize": "if mentioned for female characters",
  "shoulders": "broad/narrow/etc",

  "faceShape": "oval/round/angular/square/heart-shaped/etc",
  "eyeColor": "specific color",
  "eyeShape": "almond/round/hooded/deep-set/etc",
  "eyebrows": "thick/thin/arched/straight/bushy",
  "nose": "straight/aquiline/button/roman/etc",
  "lips": "full/thin/bow-shaped/wide",
  "jawline": "strong/soft/defined/rounded",
  "cheekbones": "high/prominent/soft",

  "hairColor": "specific color",
  "hairStyle": "how it's worn",
  "hairTexture": "straight/wavy/curly/kinky/coiled",
  "hairLength": "specific length",
  "facialHair": "if applicable for male characters",

  "skinTone": "pale/fair/olive/tan/brown/dark/ebony",
  "ethnicity": "inferred from descriptions",
  "complexion": "smooth/weathered/freckled/scarred",

  "age": "specific or estimated range",
  "ageAppearance": "youthful/mature/weathered beyond years",

  "distinctiveFeatures": ["list all unique marks, scars, features mentioned"],
  "tattoos": ["if mentioned"],
  "piercings": ["if mentioned"],

  "typicalClothing": "what they usually wear",
  "clothingColors": ["color palette"],
  "accessories": ["jewelry, weapons, items carried"],
  "overallStyle": "regal/rugged/elegant/practical/flamboyant/etc",

  "posture": "how they carry themselves",
  "gait": "how they walk/move",
  "voice": "if mentioned - tone, quality",
  "accent": "if mentioned - speech pattern",

  "physicalDescription": "Comprehensive 3-4 sentence paragraph describing entire appearance, synthesizing all above details into a cohesive narrative",
  "visualSummary": "Concise 2-3 sentence description optimized for image generation prompts - include key visual markers like hair, eyes, build, typical clothing"
}

CRITICAL INSTRUCTIONS:
- Synthesize consistent details from multiple mentions
- Prioritize first appearance descriptions for baseline
- Note any variations across scenes (but pick most common)
- Be EXTREMELY detailed for visual clarity
- If a detail isn't mentioned, use "not specified"
- Ensure physicalDescription and visualSummary are complete sentences

Return ONLY the JSON object.`;

  try {
    const response = await llmService.generate(prompt, {
      format: 'json',
      temperature: 0.5,
      maxTokens: 3000,
    });

    const profile = JSON.parse(response);

    // Validate required fields
    if (!profile.physicalDescription || !profile.visualSummary) {
      throw new Error('Missing required description fields');
    }

    return profile as DetailedCharacterAppearance;
  } catch (error) {
    console.error('❌ Error building character profile:', error);

    // Return fallback profile
    return {
      physicalDescription: characterGroup.mentions[0].description,
      visualSummary: characterGroup.mentions[0].description.substring(0, 200),
    };
  }
}

/**
 * Determine character role based on appearance frequency
 */
export function determineCharacterRole(totalAppearances: number, totalScenes: number): string {
  const frequency = totalAppearances / totalScenes;

  if (frequency > 0.4) return 'protagonist';
  if (frequency > 0.2) return 'supporting';
  if (frequency > 0.05) return 'minor';
  return 'minor';
}

// ============================================
// Database Operations
// ============================================

/**
 * Create character in database
 */
export async function createCharacter(data: {
  vividPageId: string;
  name: string;
  aliases: string[];
  initialAppearance: DetailedCharacterAppearance;
  role: string;
  firstAppearanceScene: string;
}): Promise<Character> {
  console.log(`💾 Creating character: ${data.name}`);

  const [character] = await db
    .insert(characters)
    .values({
      vividPageId: data.vividPageId,
      name: data.name,
      aliases: data.aliases,
      initialAppearance: data.initialAppearance as any,
      role: data.role,
      firstAppearanceScene: data.firstAppearanceScene,
    })
    .returning();

  return character;
}

/**
 * Get all characters for a VividPage
 */
export async function getCharactersByVividPage(vividPageId: string): Promise<Character[]> {
  return await db.query.characters.findMany({
    where: eq(characters.vividPageId, vividPageId),
    orderBy: [characters.createdAt],
  });
}

/**
 * Get a single character by ID
 */
export async function getCharacterById(characterId: string): Promise<Character | undefined> {
  return await db.query.characters.findFirst({
    where: eq(characters.id, characterId),
  });
}

/**
 * Update character appearance
 */
export async function updateCharacterAppearance(
  characterId: string,
  appearance: Partial<DetailedCharacterAppearance>
): Promise<void> {
  await db
    .update(characters)
    .set({
      initialAppearance: appearance as any,
      updatedAt: new Date(),
    })
    .where(eq(characters.id, characterId));
}

/**
 * Delete character
 */
export async function deleteCharacter(characterId: string): Promise<void> {
  await db.delete(characters).where(eq(characters.id, characterId));
}
