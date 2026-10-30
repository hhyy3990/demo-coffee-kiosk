export type QrAutoLayoutExecutionMode = "mock" | "openai" | "production-openai" | null;

export function resolveQrAutoLayoutExecutionMode(input: {
  development: boolean;
  production?: boolean;
  autoEnabled: boolean;
  mockEnabled: boolean;
  openAiEnabled: boolean;
  productionAiEnabled?: boolean;
}): QrAutoLayoutExecutionMode {
  if (input.development) {
    if (!input.autoEnabled || input.mockEnabled === input.openAiEnabled) return null;
    return input.openAiEnabled ? "openai" : "mock";
  }
  if (input.production && input.productionAiEnabled) return "production-openai";
  return null;
}
