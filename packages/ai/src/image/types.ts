export interface ImageResult {
  png: Buffer;
  seed: number;
  width: number;
  height: number;
  durationMs: number;
  /** The exact generation parameters used, for provenance/debugging. */
  params: Record<string, unknown>;
}

export interface GenerateOptions {
  prompt: string;
  negative?: string;
  /** Default 1024. */
  width?: number;
  /** Default 1024. */
  height?: number;
  /** Random (crypto-safe, 0..2^53) when absent. */
  seed?: number;
  steps?: number;
  cfg?: number;
}

export interface ImageGen {
  readonly provider: string;
  readonly model: string;
  generate(opts: GenerateOptions): Promise<ImageResult>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
