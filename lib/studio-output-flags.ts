/** Flip to `true` to restore X/Threads in Output formats and the studio tab. */
export const X_THREADS_OUTPUT_ENABLED = false;

export type StudioOutputXPostToggle = { xPost: boolean };

/** Forces `xPost` off while {@link X_THREADS_OUTPUT_ENABLED} is false. */
export function withEffectiveStudioOutputs<T extends StudioOutputXPostToggle>(
  outputs: T
): T {
  if (X_THREADS_OUTPUT_ENABLED) return outputs;
  if (!outputs.xPost) return outputs;
  return { ...outputs, xPost: false };
}
