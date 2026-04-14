/**
 * Narrow interface that extracted panel components use to reach back
 * to the owning ChatPanel. Keeps the components from taking a reference
 * to the full panel class, which would defeat the extraction.
 */
export interface PanelHost {
  post(data: any): void;
  postError(source: string, message: string): void;
}
