/**
 * Tracks caret anchor + committed/interim text while live STT dictation runs.
 */

/** Mutable dictation span inside a composer textarea. */
export class DictationRange {
  private anchor = 0;
  private beforeAnchor = '';
  private afterAnchor = '';
  private committed = '';
  private interim = '';

  /** Snapshot caret and split surrounding text at dictation start. */
  start(input: HTMLTextAreaElement): void {
    this.anchor = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? this.anchor;
    this.beforeAnchor = input.value.slice(0, this.anchor);
    this.afterAnchor = input.value.slice(end);
    this.committed = '';
    this.interim = '';
  }

  /** Append a finalized segment and clear interim preview. */
  applySegment(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) {
      this.interim = '';
      return;
    }
    let spacer = '';
    if (this.committed) {
      spacer =
        !this.committed.endsWith(' ') && !trimmed.startsWith(' ') ? ' ' : '';
    } else if (
      this.beforeAnchor &&
      !this.beforeAnchor.endsWith(' ') &&
      !trimmed.startsWith(' ')
    ) {
      spacer = ' ';
    }
    this.committed += `${spacer}${trimmed}`;
    this.interim = '';
  }

  /** Set in-flight partial text after committed segments. */
  setInterim(text: string): void {
    this.interim = text.trim();
  }

  /** Replace the entire dictation range with reconciled final text. */
  setFinal(text: string): void {
    this.committed = text.trim();
    this.interim = '';
  }

  /** Rewrite textarea value and move caret to end of dictation range. */
  render(input: HTMLTextAreaElement): void {
    const dictation = this.buildDictationText();
    input.value = `${this.beforeAnchor}${dictation}${this.afterAnchor}`;
    const caret = this.beforeAnchor.length + dictation.length;
    input.setSelectionRange(caret, caret);
  }

  /** Restore pre-dictation value on error. */
  restore(input: HTMLTextAreaElement): void {
    input.value = `${this.beforeAnchor}${this.afterAnchor}`;
    input.setSelectionRange(this.anchor, this.anchor);
  }

  /** Current dictation text (committed + interim). */
  getDictationText(): string {
    return this.buildDictationText();
  }

  private buildDictationText(): string {
    if (!this.interim) return this.committed;
    const spacer =
      this.committed && !this.committed.endsWith(' ') && !this.interim.startsWith(' ')
        ? ' '
        : '';
    return `${this.committed}${spacer}${this.interim}`;
  }
}
