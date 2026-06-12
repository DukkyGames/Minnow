/**
 * Standard LLM benchmark pack types and catalog metadata.
 */

export type StandardCategory =
  | 'reasoning'
  | 'math'
  | 'coding'
  | 'safety'
  | 'conversation'
  | 'agents';

export type StandardScoringKind = 'mcq' | 'numeric' | 'code' | 'regex' | 'judge';

export interface StandardBenchmarkItem {
  id: string;
  prompt: string;
  choices?: string[];
  groundTruth: string;
  category: StandardCategory;
  metadata?: {
    source?: string;
    license?: string;
    tier?: 'mini' | 'full';
  };
}

export interface StandardBenchmarkPack {
  id: string;
  label: string;
  category: StandardCategory;
  description: string;
  scoring: StandardScoringKind;
  miniCount: number;
  fullCount?: number;
  license?: string;
  source?: string;
  items: StandardBenchmarkItem[];
}

export interface StandardCatalogEntry {
  packId: string;
  label: string;
  family: 'standard';
  category: StandardCategory;
  purpose: string;
  method: string;
  passCriteria: string;
  tier: 'mini' | 'full';
  itemCount: number;
  promptPreview: string;
}
