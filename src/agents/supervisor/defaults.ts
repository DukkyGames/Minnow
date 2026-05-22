/**
 * Default Orchestrate supervisor configuration (browser + server seed).
 */

export interface SupervisorRepetitionConfig {
  duplicateToolCallThreshold: number;
  sameErrorThreshold: number;
  maxRestartsPerRun: number;
}

/** Full supervisor block persisted under `config.json` → `supervisor`. */
export interface SupervisorConfig {
  enabled: boolean;
  autoResume: boolean;
  repetitionDetection: boolean;
  llmEscalation: boolean;
  askUserOnBudgetExhausted: boolean;
  stallMs: number;
  maxRetriesPerTask: number;
  orchestratorHeartbeatMs: number;
  inProgressNoRunMs: number;
  spawnStuckMs: number;
  parentSilenceAfterToolMs: number;
  subAgentToolSilenceMs: number;
  runRestartCap: number;
  spawnCapPerTask: number;
  llmEscalationsPerSession: number;
  llmEscalationTimeoutMs: number;
  tickIntervalMs: number;
  repetition: SupervisorRepetitionConfig;
  escalationProviderId: string;
  escalationModelId: string;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  enabled: true,
  autoResume: true,
  repetitionDetection: true,
  llmEscalation: true,
  askUserOnBudgetExhausted: true,
  stallMs: 30_000,
  maxRetriesPerTask: 3,
  orchestratorHeartbeatMs: 90_000,
  inProgressNoRunMs: 45_000,
  spawnStuckMs: 30_000,
  parentSilenceAfterToolMs: 20_000,
  subAgentToolSilenceMs: 60_000,
  runRestartCap: 2,
  spawnCapPerTask: 3,
  llmEscalationsPerSession: 10,
  llmEscalationTimeoutMs: 8_000,
  tickIntervalMs: 5_000,
  repetition: {
    duplicateToolCallThreshold: 3,
    sameErrorThreshold: 3,
    maxRestartsPerRun: 2,
  },
  escalationProviderId: '',
  escalationModelId: '',
};
