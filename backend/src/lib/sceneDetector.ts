import { Chapter } from './epubParser.js';

// ============================================
// Types
// ============================================

export interface Scene {
  chapterNumber: number;
  chapterTitle: string;
  sceneNumber: number;
  sceneIndexGlobal: number;
  textContent: string;
  wordCount: number;
  hasDialogue: boolean;
  sceneType: 'narrative' | 'dialogue' | 'action' | 'description' | 'transition';
  characterCount: number;
}

// ============================================
// Scene Detection
// ============================================

/**
 * Detect scenes in all chapters
 */
export function detectScenes(chapters: Chapter[]): Scene[] {
  const scenes: Scene[] = [];
  let globalSceneIndex = 0;

  for (const chapter of chapters) {
    const chapterScenes = detectScenesInChapter(chapter, globalSceneIndex);

    for (const scene of chapterScenes) {
      scenes.push(scene);
      globalSceneIndex++;
    }
  }

  console.log(`✅ Detected ${scenes.length} scenes across ${chapters.length} chapters`);
  return scenes;
}

/**
 * Detect scenes within a single chapter
 */
function detectScenesInChapter(chapter: Chapter, startingGlobalIndex: number): Scene[] {
  const scenes: Scene[] = [];

  // Split chapter into paragraphs
  const paragraphs = chapter.content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  let currentScene: string[] = [];
  let sceneNumber = 1;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];

    // Check if this paragraph is a scene break
    if (isSceneBreak(para)) {
      // Save current scene if it has content
      if (currentScene.length > 0) {
        scenes.push(createScene(
          chapter,
          sceneNumber,
          startingGlobalIndex + sceneNumber - 1,
          currentScene
        ));
        sceneNumber++;
        currentScene = [];
      }
      // Don't include the scene break marker itself
      continue;
    }

    // Add paragraph to current scene
    currentScene.push(para);

    // Check if we should create a scene break here
    // (long scenes, POV changes, time jumps, etc.)
    if (shouldBreakScene(currentScene, para, paragraphs[i + 1])) {
      scenes.push(createScene(
        chapter,
        sceneNumber,
        startingGlobalIndex + sceneNumber - 1,
        currentScene
      ));
      sceneNumber++;
      currentScene = [];
    }
  }

  // Add remaining content as final scene
  if (currentScene.length > 0) {
    scenes.push(createScene(
      chapter,
      sceneNumber,
      startingGlobalIndex + sceneNumber - 1,
      currentScene
    ));
  }

  // If no scenes were created, treat entire chapter as one scene
  if (scenes.length === 0 && chapter.content.trim().length > 0) {
    scenes.push(createScene(
      chapter,
      1,
      startingGlobalIndex,
      [chapter.content]
    ));
  }

  return scenes;
}

/**
 * Check if a paragraph is an explicit scene break marker
 */
function isSceneBreak(text: string): boolean {
  const trimmed = text.trim();

  // Common scene break patterns
  const breakPatterns = [
    /^\s*\*\s*\*\s*\*\s*$/,        // * * *
    /^\s*\*{3,}\s*$/,               // ***
    /^\s*-{3,}\s*$/,                // ---
    /^\s*_{3,}\s*$/,                // ___
    /^\s*#{3,}\s*$/,                // ###
    /^\s*~{3,}\s*$/,                // ~~~
    /^\s*\*\s*$/,                   // Single *
    /^\s*•\s*•\s*•\s*$/,            // • • •
  ];

  return breakPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Determine if we should break the scene here
 */
function shouldBreakScene(
  currentScene: string[],
  currentPara: string,
  nextPara: string | undefined
): boolean {
  // Don't break on first paragraph
  if (currentScene.length < 2) {
    return false;
  }

  const sceneText = currentScene.join('\n\n');
  const wordCount = countWords(sceneText);

  // Break if scene is getting very long (>2000 words)
  if (wordCount > 2000) {
    // Try to find a good break point
    if (nextPara && (
      isTimeTransition(nextPara) ||
      isLocationChange(nextPara) ||
      isPovChange(currentPara, nextPara)
    )) {
      return true;
    }

    // Force break if scene is extremely long (>3000 words)
    if (wordCount > 3000) {
      return true;
    }
  }

  // Check for transitions
  if (nextPara) {
    if (isTimeTransition(nextPara) || isLocationChange(nextPara)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if paragraph indicates a time transition
 */
function isTimeTransition(text: string): boolean {
  const timePatterns = [
    /^(Later|Meanwhile|Soon|Eventually|Finally|Afterward|Next|Then|Now|The next (day|morning|evening|night|week|month|year))/i,
    /^(Minutes|Hours|Days|Weeks|Months|Years) (later|passed|went by)/i,
    /^Three (hours|days|weeks) (later|had passed)/i,
    /^(A (few|couple of) (minutes|hours|days|weeks) (later|passed))/i,
    /^(That (night|morning|evening|afternoon))/i,
    /^(The following (day|morning|evening|week))/i,
  ];

  return timePatterns.some(pattern => pattern.test(text.trim()));
}

/**
 * Check if paragraph indicates a location change
 */
function isLocationChange(text: string): boolean {
  const locationPatterns = [
    /^(Meanwhile,? (at|in|on))/i,
    /^(At the|In the|On the) /i,
    /^(Back (at|in|on))/i,
    /^(Elsewhere)/i,
    /^(Outside|Inside)/i,
    /^(Upstairs|Downstairs)/i,
  ];

  return locationPatterns.some(pattern => pattern.test(text.trim()));
}

/**
 * Check if there's a POV (point of view) change
 */
function isPovChange(currentPara: string, nextPara: string): boolean {
  // Look for perspective shifts
  // This is a simplified check - real POV detection would be more sophisticated

  const firstPersonMarkers = /\b(I|me|my|mine|we|us|our|ours)\b/i;
  const thirdPersonMarkers = /\b(he|she|they|him|her|them|his|hers|their)\b/i;

  const currentFirstPerson = firstPersonMarkers.test(currentPara);
  const nextFirstPerson = firstPersonMarkers.test(nextPara);

  // Detect shift between first and third person
  if (currentFirstPerson !== nextFirstPerson) {
    return true;
  }

  return false;
}

/**
 * Create a scene object from paragraphs
 */
function createScene(
  chapter: Chapter,
  sceneNumber: number,
  sceneIndexGlobal: number,
  paragraphs: string[]
): Scene {
  const textContent = paragraphs.join('\n\n');
  const wordCount = countWords(textContent);
  const hasDialogue = detectDialogue(textContent);
  const sceneType = classifyScene(textContent);
  const characterCount = estimateCharacterCount(textContent);

  return {
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    sceneNumber,
    sceneIndexGlobal,
    textContent,
    wordCount,
    hasDialogue,
    sceneType,
    characterCount,
  };
}

/**
 * Detect if text contains dialogue
 */
function detectDialogue(text: string): boolean {
  // Check for quotation marks
  const hasQuotes = /"[^"]+"|"[^"]+"|'[^']+'|'[^']+'/g.test(text);

  // Check for dialogue tags
  const dialogueTags = /\b(said|asked|replied|answered|shouted|whispered|muttered|exclaimed|responded)\b/i;
  const hasDialogueTags = dialogueTags.test(text);

  return hasQuotes || hasDialogueTags;
}

/**
 * Classify the scene type based on content
 */
function classifyScene(text: string): Scene['sceneType'] {
  const lowerText = text.toLowerCase();

  // Calculate dialogue ratio
  const quoteMatches = text.match(/["'"'][^"']+["'"']/g);
  const dialogueLength = quoteMatches ? quoteMatches.join('').length : 0;
  const dialogueRatio = dialogueLength / text.length;

  // High dialogue ratio = dialogue scene
  if (dialogueRatio > 0.3) {
    return 'dialogue';
  }

  // Check for action words
  const actionWords = /\b(ran|jumped|fought|attacked|grabbed|threw|kicked|punched|struck|fired|shot|chased|fled|rushed|dove|leaped)\b/gi;
  const actionMatches = text.match(actionWords);

  if (actionMatches && actionMatches.length > 5) {
    return 'action';
  }

  // Check for description words
  const descriptionWords = /\b(was|were|looked|appeared|seemed|beautiful|tall|wide|large|small|ancient|modern|ornate|simple)\b/gi;
  const descriptionMatches = text.match(descriptionWords);

  if (descriptionMatches && descriptionMatches.length > 10 && dialogueRatio < 0.1) {
    return 'description';
  }

  // Check for transition markers
  if (isTimeTransition(text) || isLocationChange(text)) {
    return 'transition';
  }

  // Default to narrative
  return 'narrative';
}

/**
 * Estimate number of characters (people) in scene
 * This is a rough estimate based on proper nouns and pronouns
 */
function estimateCharacterCount(text: string): number {
  // Count capitalized words that might be names
  const namePattern = /\b[A-Z][a-z]+\b/g;
  const possibleNames = text.match(namePattern) || [];
  const uniqueNames = new Set(possibleNames);

  // Filter out common non-name words
  const commonWords = new Set(['The', 'A', 'An', 'I', 'He', 'She', 'They', 'It', 'We', 'You', 'This', 'That', 'These', 'Those', 'When', 'Where', 'Why', 'How', 'What', 'Which', 'Who']);
  const likelyNames = Array.from(uniqueNames).filter(name => !commonWords.has(name));

  // Count pronouns
  const pronouns = text.match(/\b(he|she|they|him|her|them)\b/gi) || [];

  // Estimate: at least 1 character if there's any dialogue or pronouns
  // Otherwise, use name count (capped at reasonable max)
  if (pronouns.length > 0 || detectDialogue(text)) {
    return Math.max(1, Math.min(likelyNames.length, 10));
  }

  return Math.min(likelyNames.length, 10);
}

/**
 * Count words in text
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}
