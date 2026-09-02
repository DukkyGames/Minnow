export interface QuickEditSelectionRange {
  from: number;
  to: number;
  fromLine: number;
  toLine: number;
  text: string;
}

export interface QuickEditSession {
  filePath: string;
  range: QuickEditSelectionRange;
  originalText: string;
  instruction: string;
  proposedText: string;
  streaming: boolean;
}
