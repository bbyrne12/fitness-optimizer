"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Edit,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { deletePlan, renamePlan, setActivePlan } from "./actions";

export type PlanListItem = {
  id: string;
  name: string;
  source: string;
  is_active: boolean;
  exerciseCount: number;
  created_at: string;
};

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function PlansList({ plans }: { plans: PlanListItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runAction = (
    id: string,
    fn: () => Promise<{ error?: string }>,
  ) => {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const res = await fn();
      setPendingId(null);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onSetActive = (id: string) => runAction(id, () => setActivePlan(id));

  const onDelete = (id: string, name: string) => {
    const ok = window.confirm(
      `Delete plan "${name}"? This will permanently remove all exercises in this plan.`,
    );
    if (!ok) return;
    runAction(id, () => deletePlan(id));
  };

  const onRename = (id: string, currentName: string) => {
    const next = window.prompt("Rename plan", currentName);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    runAction(id, () => renamePlan(id, trimmed));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-400">
          {plans.length} {plans.length === 1 ? "plan" : "plans"} total
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            asChild
            variant="outline"
            className="border-zinc-800 bg-zinc-900 text-white hover:bg-zinc-800 hover:text-white"
          >
            <Link href="/plans/new">
              <Plus className="h-4 w-4" />
              Create Manual Plan
            </Link>
          </Button>
          <Button
            asChild
            className="bg-lime-400 text-zinc-950 hover:bg-lime-300"
          >
            <Link href="/plan">
              <Sparkles className="h-4 w-4" />
              Generate AI Plan
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const isBusy = isPending && pendingId === plan.id;
          const isGenerated = plan.source === "generated";
          return (
            <Card
              key={plan.id}
              className={cn(
                "border-zinc-800 bg-zinc-900",
                plan.is_active && "ring-1 ring-lime-400/40",
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <CardTitle className="text-lg text-white">
                      {plan.name}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      {isGenerated ? (
                        <Badge className="gap-1 bg-lime-400/10 text-lime-400 hover:bg-lime-400/20">
                          <Sparkles className="h-3 w-3" />
                          Generated
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        >
                          Manual
                        </Badge>
                      )}
                      {plan.is_active && (
                        <Badge className="gap-1 bg-lime-400 text-zinc-950 hover:bg-lime-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-white">
                    {plan.exerciseCount}{" "}
                    {plan.exerciseCount === 1 ? "exercise" : "exercises"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Created {formatDate(plan.created_at)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {!plan.is_active && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onSetActive(plan.id)}
                      disabled={isBusy}
                      className="bg-lime-400 text-zinc-950 hover:bg-lime-300"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Set Active
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRename(plan.id, plan.name)}
                    disabled={isBusy}
                    className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 hover:text-white"
                  >
                    <Link href={`/plans/${plan.id}`}>
                      <Edit className="h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onDelete(plan.id, plan.name)}
                    disabled={isBusy}
                    className="border-red-900/60 bg-transparent text-red-300 hover:bg-red-950/40 hover:text-red-200"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
