export interface UiDesignerConfig {
  providerId?: string;
  modelId?: string;
  fallbackToChatModel?: boolean;
}

export interface UiDesignerConfigMeta {
  uiDesigner?: UiDesignerConfig;
}

export interface ResolveUiDesignerModelInput {
  uiDesigner?: UiDesignerConfig | null;
  chatProviderId: string;
  chatModelId: string;
}

export interface ResolvedUiDesignerModel {
  providerId: string;
  modelId: string;
}

const DEFAULT_UI_DESIGNER: UiDesignerConfig = {
  providerId: '',
  modelId: '',
  fallbackToChatModel: true,
};

export function normalizeUiDesignerConfig(raw: unknown): UiDesignerConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_UI_DESIGNER };
  }
  const row = raw as Record<string, unknown>;
  return {
    providerId: typeof row.providerId === 'string' ? row.providerId : '',
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    fallbackToChatModel:
      row.fallbackToChatModel === false ? false : true,
  };
}

export function resolveUiDesignerModel(
  input: ResolveUiDesignerModelInput,
): ResolvedUiDesignerModel | { error: string } {
  const cfg = normalizeUiDesignerConfig(input.uiDesigner);
  const hasDedicated =
    Boolean(cfg.providerId?.trim()) && Boolean(cfg.modelId?.trim());

  if (hasDedicated) {
    return {
      providerId: cfg.providerId!.trim(),
      modelId: cfg.modelId!.trim(),
    };
  }

  if (cfg.fallbackToChatModel !== false) {
    if (!input.chatModelId?.trim()) {
      return { error: 'No model selected for this chat' };
    }
    return {
      providerId: input.chatProviderId,
      modelId: input.chatModelId,
    };
  }

  return {
    error: 'Configure UI Designer model in Settings (uiDesigner.providerId and modelId).',
  };
}
