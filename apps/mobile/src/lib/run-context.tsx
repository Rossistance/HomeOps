// Plan execution now dispatches to the SERVER run engine (POST /api/runs/start)
// — the same durable runtime the web client uses. The server resolves each
// step's real tool input (the old on-device runner sent empty inputs, so every
// web.search/web.read step instantly blocked with "Provide a search `query`").
// This provider just starts the run and polls it for live progress.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, type AgentPlan, type RunRec } from "@/lib/api";

export interface RunStepState {
  toolId: string | null;
  title: string;
  detail: string;
  requiresApproval: boolean;
  status: "pending" | "running" | "done" | "blocked";
  output?: string;
  approvalId?: string;
}

export interface ActiveRun {
  id: string;
  planTitle: string;
  status: "running" | "waiting" | "completed" | "failed";
  steps: RunStepState[];
  startedAt: string;
  completedAt?: string;
}

interface RunCtx {
  activeRun: ActiveRun | null;
  startRun: (plan: AgentPlan) => Promise<void>;
  clearRun: () => void;
}

const Ctx = createContext<RunCtx>({ activeRun: null, startRun: async () => {}, clearRun: () => {} });
export function useRun() { return useContext(Ctx); }

function mapStepStatus(s: string, approvalId: string | null): RunStepState["status"] {
  switch (s) {
    case "done": case "completed": case "succeeded": return "done";
    case "running": case "in_progress": return "running";
    case "blocked": case "waiting_approval": case "waiting_for_approval": case "failed": case "error": return "blocked";
    default: return approvalId ? "blocked" : "pending";
  }
}

function mapRunStatus(s: string): ActiveRun["status"] {
  switch (s) {
    case "completed": case "succeeded": return "completed";
    case "failed": case "error": case "cancelled": return "failed";
    case "waiting_approval": case "waiting_for_approval": case "paused": return "waiting";
    default: return "running";
  }
}

function toActiveRun(run: RunRec, startedAt: string): ActiveRun {
  const status = mapRunStatus(run.status);
  return {
    id: run.id,
    planTitle: run.title,
    status,
    steps: (run.steps ?? []).map((st) => ({
      toolId: st.toolId,
      title: st.title,
      detail: st.detail,
      requiresApproval: !!st.approvalId,
      status: mapStepStatus(st.status, st.approvalId),
      approvalId: st.approvalId ?? undefined,
      output: st.status === "waiting_approval" || st.approvalId ? "Waiting for your approval in the Inbox." : undefined,
    })),
    startedAt,
    completedAt: status === "completed" || status === "failed" ? new Date().toISOString() : undefined,
  };
}

const POLL_MS = 2500;
const POLL_MAX_MS = 5 * 60 * 1000;

export function RunProvider({ children }: { children: React.ReactNode }) {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const startRun = useCallback(async (plan: AgentPlan) => {
    if (startingRef.current) return;
    startingRef.current = true;
    stopPolling();
    const startedAt = new Date().toISOString();

    // Optimistic shell so the Activity screen shows the run immediately.
    setActiveRun({
      id: "pending",
      planTitle: plan.title,
      status: "running",
      steps: plan.steps.map((s) => ({
        toolId: s.toolId, title: s.title, detail: s.detail,
        requiresApproval: s.requiresApproval, status: "pending" as const,
      })),
      startedAt,
    });

    const res = await api.startRunPlan(plan);
    startingRef.current = false;
    if (!res.run) {
      setActiveRun((prev) => prev ? {
        ...prev,
        status: "failed",
        completedAt: new Date().toISOString(),
        steps: prev.steps.map((s, i) => i === 0 ? {
          ...s, status: "blocked",
          output: res.error === "insufficient_role"
            ? "Running plans needs a Limited Member role or higher."
            : res.message ?? res.error ?? "The server couldn't start this run.",
        } : s),
      } : prev);
      return;
    }

    setActiveRun(toActiveRun(res.run, startedAt));
    const runId = res.run.id;
    const deadline = Date.now() + POLL_MAX_MS;
    pollRef.current = setInterval(async () => {
      const r = await api.getRun(runId);
      if (r.run) {
        const mapped = toActiveRun(r.run, startedAt);
        setActiveRun(mapped);
        if (mapped.status === "completed" || mapped.status === "failed" || mapped.status === "waiting") {
          // "waiting" resumes server-side after the approval decision; keep polling
          // only while the run can still move on its own.
          if (mapped.status !== "waiting") stopPolling();
        }
      }
      if (Date.now() > deadline) stopPolling();
    }, POLL_MS);
  }, [stopPolling]);

  const clearRun = useCallback(() => {
    stopPolling();
    setActiveRun(null);
  }, [stopPolling]);

  return <Ctx.Provider value={{ activeRun, startRun, clearRun }}>{children}</Ctx.Provider>;
}
