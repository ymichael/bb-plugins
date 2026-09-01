export type FloatingOfficeCollapsedKind =
  | "floorplan"
  | "hidden"
  | "worker";

interface ResolveFloatingOfficeCollapsedKindArgs {
  activeThreadId: string | null;
  hasCurrentWorker: boolean;
  pathname: string;
}

export function resolveFloatingOfficeCollapsedKind({
  activeThreadId,
  hasCurrentWorker,
  pathname,
}: ResolveFloatingOfficeCollapsedKindArgs): FloatingOfficeCollapsedKind {
  if (activeThreadId !== null) {
    return hasCurrentWorker ? "worker" : "hidden";
  }
  return pathname === "/" ? "floorplan" : "hidden";
}
