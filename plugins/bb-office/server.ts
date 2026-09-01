import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BbPluginApi,
  PluginCliResult,
} from "@get-bb/plugin-sdk";
import { bbOfficeRpcContract } from "./office-config-contract";
import {
  type OfficeConfigToolParameters,
  type OfficeEdit,
  officeConfigToolParametersSchema,
} from "./office-config-schema";
import {
  createOfficeConfigModule,
  type OfficeConfigModule,
} from "./office-config";
import { createOfficeUsageModule } from "./office-usage";

export function resolveAssetDirectory(moduleUrl: string): string {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl));
  const adjacentDirectory = join(moduleDirectory, "assets");
  if (existsSync(adjacentDirectory)) return adjacentDirectory;
  const parentDirectory = join(moduleDirectory, "..", "assets");
  if (existsSync(parentDirectory)) return parentDirectory;
  throw new Error(`BB Office assets are missing beside ${moduleDirectory}`);
}

const ASSET_DIRECTORY = resolveAssetDirectory(import.meta.url);

interface AssetFile {
  filePath: string;
  routePath: string;
}

function collectAssets(directory: string): AssetFile[] {
  const assets: AssetFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      assets.push(...collectAssets(filePath));
    } else {
      assets.push({
        filePath,
        routePath: posix.join(
          "/assets",
          relative(ASSET_DIRECTORY, filePath).split("\\").join("/"),
        ),
      });
    }
  }
  return assets;
}

function contentType(path: string): string {
  if (extname(path) === ".png") return "image/png";
  if (extname(path) === ".json") return "application/json";
  if (extname(path) === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function assetResponse(asset: AssetFile): Promise<Response> {
  const bytes = await readFile(asset.filePath);
  return new Response(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-type": contentType(asset.filePath),
      },
    },
  );
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toolEdits(params: OfficeConfigToolParameters): OfficeEdit[] {
  const edits: OfficeEdit[] = [];
  if (params.appearance !== undefined) {
    edits.push({ kind: "set-appearance", mode: params.appearance });
  }
  const behavior = {
    ...(params.inactiveExitAfterMinutes === undefined
      ? {}
      : { inactiveExitAfterMinutes: params.inactiveExitAfterMinutes }),
    ...(params.meetingRelations === undefined
      ? {}
      : { meetingRelations: params.meetingRelations }),
    ...(params.ambientMotion === undefined
      ? {}
      : { ambientMotion: params.ambientMotion }),
  };
  if (Object.keys(behavior).length > 0) {
    edits.push({ kind: "set-behavior", changes: behavior });
  }
  const decor = {
    ...(params.pets === undefined ? {} : { pets: params.pets }),
    ...(params.coffee === undefined ? {} : { coffee: params.coffee }),
    ...(params.plants === undefined ? {} : { plants: params.plants }),
    ...(params.wallDecor === undefined
      ? {}
      : { wallDecor: params.wallDecor }),
  };
  if (Object.keys(decor).length > 0) {
    edits.push({ kind: "set-decor", changes: decor });
  }
  return edits;
}

function assertToolShape(params: OfficeConfigToolParameters): void {
  const edits = toolEdits(params);
  if (params.action === "inspect") {
    if (
      params.expectedRevision !== undefined ||
      params.proposalId !== undefined ||
      edits.length > 0
    ) {
      throw new Error("inspect accepts only the action field");
    }
    return;
  }
  if (params.action === "apply") {
    if (
      params.expectedRevision === undefined ||
      params.proposalId === undefined ||
      edits.length > 0
    ) {
      throw new Error(
        "apply requires expectedRevision and proposalId, with no change fields",
      );
    }
    return;
  }
  if (params.expectedRevision === undefined || params.proposalId !== undefined) {
    throw new Error(
      `${params.action} requires expectedRevision and does not accept proposalId`,
    );
  }
  if (params.action === "preview" && edits.length === 0) {
    throw new Error("preview requires at least one change field");
  }
  if (params.action === "reset" && edits.length > 0) {
    throw new Error("reset does not accept change fields");
  }
}

async function runTool(
  officeConfig: OfficeConfigModule,
  rawParams: OfficeConfigToolParameters,
): Promise<string> {
  const params = officeConfigToolParametersSchema.parse(rawParams);
  assertToolShape(params);
  if (params.action === "inspect") {
    return json(await officeConfig.read());
  }
  if (params.action === "apply") {
    return json(
      await officeConfig.apply({
        expectedRevision: params.expectedRevision ?? 0,
        proposalId: params.proposalId ?? "",
      }),
    );
  }
  return json(
    await officeConfig.preview({
      expectedRevision: params.expectedRevision ?? 0,
      base: params.action === "reset" ? "factory" : "current",
      edits: params.action === "reset" ? [] : toolEdits(params),
    }),
  );
}

function parseToggle(value: string, flag: string): boolean {
  if (value === "on" || value === "show" || value === "true") return true;
  if (value === "off" || value === "hide" || value === "false") return false;
  throw new Error(`${flag} expects on/off, show/hide, or true/false`);
}

function parsePreviewArgs(argv: readonly string[]): {
  expectedRevision: number;
  edits: OfficeEdit[];
} {
  const params: OfficeConfigToolParameters = { action: "preview" };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value) throw new Error(`Missing value for ${flag ?? "option"}`);
    if (flag === "--revision") params.expectedRevision = Number(value);
    else if (flag === "--appearance") {
      params.appearance = value as OfficeConfigToolParameters["appearance"];
    } else if (flag === "--leave-after") {
      params.inactiveExitAfterMinutes = Number(value);
    } else if (flag === "--meeting-relations") {
      params.meetingRelations =
        value === "none"
          ? []
          : (value.split(",") as NonNullable<
              OfficeConfigToolParameters["meetingRelations"]
            >);
    } else if (flag === "--ambient") {
      params.ambientMotion = value as OfficeConfigToolParameters["ambientMotion"];
    } else if (flag === "--pets") params.pets = parseToggle(value, flag);
    else if (flag === "--coffee") params.coffee = parseToggle(value, flag);
    else if (flag === "--plants") params.plants = parseToggle(value, flag);
    else if (flag === "--wall-decor") {
      params.wallDecor = parseToggle(value, flag);
    } else throw new Error(`Unknown option ${flag}`);
  }
  const parsed = officeConfigToolParametersSchema.parse(params);
  assertToolShape(parsed);
  return {
    expectedRevision: parsed.expectedRevision ?? 0,
    edits: toolEdits(parsed),
  };
}

const CLI_HELP = `Usage:
  bb office show
  bb office preview --revision N [changes]
  bb office apply PROPOSAL_ID --revision N
  bb office reset --revision N

Changes:
  --appearance follow-bb|neutral|original
  --leave-after 5..240
  --meeting-relations same-worktree,siblings,parent-child|none
  --ambient rare|off
  --pets show|hide
  --coffee show|hide
  --plants show|hide
  --wall-decor show|hide
`;

async function runCli(
  officeConfig: OfficeConfigModule,
  argv: string[],
): Promise<PluginCliResult> {
  try {
    const command = argv[0] ?? "help";
    if (command === "help" || command === "--help" || command === "-h") {
      if (argv.length !== 1 && argv.length !== 0) throw new Error("help accepts no arguments");
      return { exitCode: 0, stdout: CLI_HELP };
    }
    if (command === "show" || command === "export") {
      if (argv.length !== 1) throw new Error(`${command} accepts no arguments`);
      const snapshot = await officeConfig.read();
      return {
        exitCode: 0,
        stdout: json(command === "export" ? snapshot.config : snapshot),
      };
    }
    if (command === "preview") {
      const parsed = parsePreviewArgs(argv.slice(1));
      return {
        exitCode: 0,
        stdout: json(
          await officeConfig.preview({
            expectedRevision: parsed.expectedRevision,
            base: "current",
            edits: parsed.edits,
          }),
        ),
      };
    }
    if (command === "reset") {
      if (argv.length !== 3 || argv[1] !== "--revision") {
        throw new Error("reset expects --revision N");
      }
      return {
        exitCode: 0,
        stdout: json(
          await officeConfig.preview({
            expectedRevision: Number(argv[2]),
            base: "factory",
            edits: [],
          }),
        ),
      };
    }
    if (command === "apply") {
      if (argv.length !== 4 || argv[2] !== "--revision") {
        throw new Error("apply expects PROPOSAL_ID --revision N");
      }
      return {
        exitCode: 0,
        stdout: json(
          await officeConfig.apply({
            proposalId: argv[1] ?? "",
            expectedRevision: Number(argv[3]),
          }),
        ),
      };
    }
    throw new Error(`Unknown BB Office command ${command}`);
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : "BB Office command failed"}\n`,
    };
  }
}

export default function bbOffice(bb: BbPluginApi) {
  const officeConfig = createOfficeConfigModule({
    kv: bb.storage.kv,
    publish: (revision) => {
      bb.realtime.publish("office-config-changed", { revision });
    },
  });
  const officeUsage = createOfficeUsageModule({
    usageLimits: ({ hostId, providerId }) =>
      bb.sdk.system.usageLimits({
        ...(hostId === null ? {} : { hostId }),
        providerId,
      }),
  });
  bb.rpc.register(bbOfficeRpcContract, {
    readOfficeConfig: () => officeConfig.read(),
    previewOfficeConfig: (command) => officeConfig.preview(command),
    applyOfficeConfig: (command) => officeConfig.apply(command),
    readOfficeUsage: (input) => officeUsage.read(input),
  });
  bb.cli.register({
    name: "office",
    summary: "Inspect and safely customize the BB Office",
    commands: [
      { name: "show", summary: "Show the current office configuration", usage: "bb office show" },
      { name: "preview", summary: "Validate a proposed office change", usage: "bb office preview --revision N [changes]" },
      { name: "apply", summary: "Apply a validated office proposal", usage: "bb office apply PROPOSAL_ID --revision N" },
      { name: "reset", summary: "Preview a reset to the factory office", usage: "bb office reset --revision N" },
      { name: "export", summary: "Export the portable office configuration", usage: "bb office export" },
    ],
    run: (argv) => runCli(officeConfig, argv),
  });
  bb.agents.registerTool({
    name: "configure_bb_office",
    description:
      "Inspect, preview, apply, or reset the global BB Office appearance, behavior, and decor. Always inspect first, preview changes, explain the exact proposal, and apply only after the user approves it.",
    instructions:
      "Use action=inspect first. Use action=preview with expectedRevision and requested changes. Show the proposal summary to the user. Use action=apply with the returned proposalId and baseRevision only after approval. Use action=reset to preview factory defaults.",
    parameters: officeConfigToolParametersSchema,
    presentation: {
      label: {
        pending: "Updating the BB Office",
        completed: "Updated the BB Office",
      },
      icon: { glyph: "bb-office/floor-plan" },
    },
    execute: (params) => runTool(officeConfig, params),
  });
  bb.agents.configure(() => ({
    tools: ["configure_bb_office"],
    skills: ["bb-office-customization"],
  }));
  const assets = collectAssets(ASSET_DIRECTORY);
  for (const asset of assets) {
    bb.http.route("GET", asset.routePath, () => assetResponse(asset));
  }
  bb.log.info(
    `BB Office loaded the pinned Pixel Agents engine with ${assets.length} assets`,
  );
}
