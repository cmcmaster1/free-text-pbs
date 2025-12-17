export interface ScoreComponents {
  lexical: number;
  semantic?: number;
}

export function blendedScore({ lexical, semantic }: ScoreComponents): number {
  if (semantic === undefined) {
    return lexical;
  }
  return 0.4 * lexical + 0.6 * semantic;
}
