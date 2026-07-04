import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { api, type AgentPlan } from "@/lib/api";

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

export function RunProvider({ children }: { children: React.ReactNode }) {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const runningRef = useRef(false);

  const startRun = useCallback(async (plan: AgentPlan) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const run: ActiveRun = {
      id: `run-${Date.now()}`,
      planTitle: plan.title,
      status: "running",
      steps: plan.steps.map((s) => ({
        toolId: s.toolId,
        title: s.title,
        detail: s.detail,
        requiresApproval: s.requiresApproval,
        status: "pending" as const,
      })),
      startedAt: new Date().toISOString(),
    };

    const snapshot = () => setActiveRun({ ...run, steps: [...run.steps] });
    snapshot();

    let anyApproval = false, anyFail = false, ran = 0;

    for (let i = 0; i < run.steps.length; i++) {
      const step = run.steps[i];

      if (!step.toolId) {
        run.steps[i] = { ...step, status: "done", detail: step.detail || "Reasoning step." };
        snapshot(); continue;
      }

      run.steps[i] = { ...step, status: "running" };
      snapshot();

      if (step.requiresApproval) {
        const apr = await api.createApproval(step.toolId, {}, { category: "plan", preview: step.title });
        anyApproval = true;
        run.steps[i] = { ...run.steps[i], status: "blocked", output: apr.error ? `Approval error: ${apr.error}` : "Waiting for your approval in the Approvals tab.", approvalId: apr.approval?.id };
        snapshot(); continue;
      }

      const res = await api.runStep(step.toolId, {});
      if (res.ok) {
        ran++;
        const out = res.result ? (typeof res.result === "string" ? res.result : JSON.stringify(res.result)) : "ok";
        run.steps[i] = { ...run.steps[i], status: "done", output: out.slice(0, 200) };
      } else {
        anyFail = true;
        run.steps[i] = { ...run.steps[i], status: "blocked", output: res.message ?? res.error ?? "Step failed." };
      }
      snapshot();
    }

    run.status = anyApproval ? "waiting" : anyFail ? "failed" : "completed";
    run.completedAt = new Date().toISOString();
    setActiveRun({ ...run, steps: [...run.steps] });
    runningRef.current = false;
  }, []);

  const clearRun = useCallback(() => {
    if (runningRef.current) return;
    setActiveRun(null);
  }, []);

  return <Ctx.Provider value={{ activeRun, startRun, clearRun }}>{children}</Ctx.Provider>;
}
