export interface ImageResult {
  png: Buffer;
  seed: number;
  width: number;
  height: number;
  durationMs: number;
  /** The exact generation parameters used, for provenance/debugging. */
  params: Record<string, unknown>;
}

/** One LoRA to stack onto the generation (issue #2). */
export interface LoraSpec {
  /** LoRA filename as installed on the ComfyUI server. */
  name: string;
  strengthModel: number;
  strengthClip: number;
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
  /**
   * Optional LoRAs to chain into the graph. Empty/absent → the generated
   * workflow is byte-identical to the no-LoRA path.
   */
  loras?: LoraSpec[];
}

export interface ImageGen {
  readonly provider: string;
  readonly model: string;
  generate(opts: GenerateOptions): Promise<ImageResult>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
