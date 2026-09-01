import { createHash, randomUUID } from "node:crypto";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import {
  DEFAULT_OFFICE_CONFIG,
  type OfficeApplyCommand,
  type OfficeChangeSummary,
  type OfficeConfig,
  type OfficeEdit,
  type OfficePreview,
  type OfficePreviewCommand,
  type OfficeSnapshot,
  officeConfigSchema,
} from "./office-config-schema";

const PROPOSAL_LIFETIME_MS = 10 * 60 * 1000;
const STORAGE_KEY = "office-config/global";

interface StoredOfficeConfig {
  storageVersion: 1;
  revision: number;
  updatedAtMs: number;
  config: OfficeConfig;
}

interface Proposal {
  baseRevision: number;
  expiresAtMs: number;
  config: OfficeConfig;
  digest: string;
  summary: OfficeChangeSummary;
}

export class OfficeConfigError extends Error {
  readonly code:
    | "invalid_stored_config"
    | "revision_conflict"
    | "proposal_expired"
    | "proposal_not_found"
    | "no_changes";

  constructor(code: OfficeConfigError["code"], message: string) {
    super(message);
    this.name = "OfficeConfigError";
    this.code = code;
  }
}

export interface OfficeConfigModule {
  read(): Promise<OfficeSnapshot>;
  preview(command: OfficePreviewCommand): Promise<OfficePreview>;
  apply(command: OfficeApplyCommand): Promise<OfficeSnapshot>;
}

function canonicalConfig(config: OfficeConfig): OfficeConfig {
  const parsed = officeConfigSchema.parse(config);
  return {
    schemaVersion: 1,
    appearance: { mode: parsed.appearance.mode },
    behavior: {
      inactiveExitAfterMinutes: parsed.behavior.inactiveExitAfterMinutes,
      meetingRelations: [...parsed.behavior.meetingRelations].sort(),
      ambientMotion: parsed.behavior.ambientMotion,
    },
    decor: {
      pets: parsed.decor.pets,
      coffee: parsed.decor.coffee,
      plants: parsed.decor.plants,
      wallDecor: parsed.decor.wallDecor,
    },
  };
}

function digestConfig(config: OfficeConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function cloneFactoryConfig(): OfficeConfig {
  return canonicalConfig(DEFAULT_OFFICE_CONFIG);
}

function applyEdits(base: OfficeConfig, edits: readonly OfficeEdit[]): OfficeConfig {
  const kinds = edits.map((edit) => edit.kind);
  if (new Set(kinds).size !== kinds.length) {
    throw new OfficeConfigError(
      "no_changes",
      "Each preview may change appearance, behavior, or decor at most once",
    );
  }
  let next = base;
  for (const edit of edits) {
    if (edit.kind === "set-appearance") {
      next = { ...next, appearance: { mode: edit.mode } };
    } else if (edit.kind === "set-behavior") {
      next = {
        ...next,
        behavior: { ...next.behavior, ...edit.changes },
      };
    } else {
      next = { ...next, decor: { ...next.decor, ...edit.changes } };
    }
  }
  return canonicalConfig(next);
}

function changeSummary(
  before: OfficeConfig,
  after: OfficeConfig,
): OfficeChangeSummary {
  const behavior = Object.keys(after.behavior).filter(
    (key) =>
      JSON.stringify(before.behavior[key as keyof OfficeConfig["behavior"]]) !==
      JSON.stringify(after.behavior[key as keyof OfficeConfig["behavior"]]),
  );
  const decor = Object.keys(after.decor).filter(
    (key) =>
      before.decor[key as keyof OfficeConfig["decor"]] !==
      after.decor[key as keyof OfficeConfig["decor"]],
  );
  return {
    appearance: before.appearance.mode !== after.appearance.mode,
    behavior,
    decor,
  };
}

function validateRuntime(config: OfficeConfig): string[] {
  return officeConfigSchema.safeParse(config).success
    ? []
    : ["The office configuration is invalid"];
}

function parseStored(value: unknown): StoredOfficeConfig {
  const envelope = value as Partial<StoredOfficeConfig> | null;
  if (
    !envelope ||
    envelope.storageVersion !== 1 ||
    !Number.isInteger(envelope.revision) ||
    typeof envelope.updatedAtMs !== "number"
  ) {
    throw new OfficeConfigError(
      "invalid_stored_config",
      "BB Office found an unsupported stored office configuration",
    );
  }
  const parsed = officeConfigSchema.safeParse(envelope.config);
  if (!parsed.success) {
    throw new OfficeConfigError(
      "invalid_stored_config",
      "BB Office found an invalid stored office configuration",
    );
  }
  return {
    storageVersion: 1,
    revision: envelope.revision ?? 0,
    updatedAtMs: envelope.updatedAtMs,
    config: canonicalConfig(parsed.data),
  };
}

export function createOfficeConfigModule(options: {
  kv: PluginKvStorage;
  now?: () => number;
  publish: (revision: number) => void;
}): OfficeConfigModule {
  const now = options.now ?? Date.now;
  const proposals = new Map<string, Proposal>();
  let applyTail = Promise.resolve();

  const read = async (): Promise<OfficeSnapshot> => {
    const stored = await options.kv.get<unknown>(STORAGE_KEY);
    if (stored === undefined) {
      const config = cloneFactoryConfig();
      return {
        revision: 0,
        source: "implicit-factory",
        updatedAtMs: null,
        config,
        digest: digestConfig(config),
      };
    }
    const parsed = parseStored(stored);
    return {
      revision: parsed.revision,
      source: "persisted",
      updatedAtMs: parsed.updatedAtMs,
      config: parsed.config,
      digest: digestConfig(parsed.config),
    };
  };

  const preview = async (
    command: OfficePreviewCommand,
  ): Promise<OfficePreview> => {
    const current = await read();
    if (current.revision !== command.expectedRevision) {
      throw new OfficeConfigError(
        "revision_conflict",
        `Office revision ${command.expectedRevision} is stale; current revision is ${current.revision}`,
      );
    }
    const base =
      command.base === "factory" ? cloneFactoryConfig() : current.config;
    const candidate = applyEdits(base, command.edits);
    const digest = digestConfig(candidate);
    if (digest === current.digest) {
      throw new OfficeConfigError("no_changes", "The office is already configured that way");
    }
    const issues = validateRuntime(candidate);
    if (issues.length > 0) {
      return {
        outcome: "invalid",
        baseRevision: current.revision,
        issues,
      };
    }
    const proposalId = randomUUID();
    const proposal: Proposal = {
      baseRevision: current.revision,
      expiresAtMs: now() + PROPOSAL_LIFETIME_MS,
      config: candidate,
      digest,
      summary: changeSummary(current.config, candidate),
    };
    proposals.set(proposalId, proposal);
    return {
      outcome: "ready",
      baseRevision: proposal.baseRevision,
      proposalId,
      expiresAtMs: proposal.expiresAtMs,
      config: proposal.config,
      digest: proposal.digest,
      summary: proposal.summary,
    };
  };

  const applyUnlocked = async (
    command: OfficeApplyCommand,
  ): Promise<OfficeSnapshot> => {
    const proposal = proposals.get(command.proposalId);
    if (!proposal) {
      throw new OfficeConfigError(
        "proposal_not_found",
        "That office proposal is unavailable; preview the change again",
      );
    }
    if (proposal.expiresAtMs <= now()) {
      proposals.delete(command.proposalId);
      throw new OfficeConfigError(
        "proposal_expired",
        "That office proposal expired; preview the change again",
      );
    }
    const current = await read();
    if (
      current.revision !== command.expectedRevision ||
      proposal.baseRevision !== current.revision
    ) {
      throw new OfficeConfigError(
        "revision_conflict",
        `Office revision ${command.expectedRevision} is stale; current revision is ${current.revision}`,
      );
    }
    const issues = validateRuntime(proposal.config);
    if (issues.length > 0) {
      throw new Error(`Office proposal no longer validates: ${issues.join("; ")}`);
    }
    const updatedAtMs = now();
    const revision = current.revision + 1;
    await options.kv.set(STORAGE_KEY, {
      storageVersion: 1,
      revision,
      updatedAtMs,
      config: proposal.config,
    } satisfies StoredOfficeConfig);
    proposals.delete(command.proposalId);
    options.publish(revision);
    return {
      revision,
      source: "persisted",
      updatedAtMs,
      config: proposal.config,
      digest: proposal.digest,
    };
  };

  const apply = async (
    command: OfficeApplyCommand,
  ): Promise<OfficeSnapshot> => {
    const prior = applyTail;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = prior.then(() => gate);
    applyTail = queued;
    await prior;
    try {
      return await applyUnlocked(command);
    } finally {
      release();
    }
  };

  return { read, preview, apply };
}
