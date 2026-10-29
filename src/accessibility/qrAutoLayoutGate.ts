export type QrAutoLayoutExecutionMode = "mock" | "openai" | null;

export function resolveQrAutoLayoutExecutionMode(input: {
  development: boolean;
  autoEnabled: boolean;
  mockEnabled: boolean;
  openAiEnabled: boolean;
}): QrAutoLayoutExecutionMode {
  if (!input.development || !input.autoEnabled ||
      input.mockEnabled === input.openAiEnabled) return null;
  return input.openAiEnabled ? "openai" : "mock";
}
