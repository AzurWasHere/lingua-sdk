export interface ExtractedLocation {
  /** Relative to config.root, forward slashes. */
  file: string;
  /** 1-based. */
  line: number;
  /** 0-based, in UTF-16 code units. */
  column: number;
}

export interface ExtractedMessage {
  id: string;
  message: string;
  context?: string;
  comment?: string;
  /** i18next object form: category → text; `message` is `other`. */
  plural?: Record<string, string>;
  locations: ExtractedLocation[];
}

export interface ExtractWarning extends ExtractedLocation {
  message: string;
}

export interface ExtractResult {
  messages: ExtractedMessage[];
  warnings: ExtractWarning[];
  /** Files matched by include/exclude. */
  files: string[];
}

export interface ExtractOptions {
  functionNames: string[];
  componentNames: string[];
}
