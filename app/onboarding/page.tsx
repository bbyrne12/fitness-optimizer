"use client";

import { useMemo, useState, useTransition } from "react";

import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { saveOnboardingProfile } from "./actions";

const GOALS = [
  "Build Strength",
  "Lose Weight",
  "Improve Cardio",
  "General Fitness",
] as const;

const EXPERIENCE_LEVELS = [
  "Beginner (less than 6 months)",
  "Intermediate (6 months to 2 years)",
  "Advanced (2+ years)",
] as const;

const EQUIPMENT = [
  "Full gym access",
  "Dumbbells",
  "Barbell and plates",
  "Resistance bands",
  "Bodyweight only",
] as const;

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>(1);
  const [primaryGoal, setPrimaryGoal] = useState<string>("");
  const [experienceLevel, setExperienceLevel] = useState<string>("");
  const [availableEquipment, setAvailableEquipment] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const progress = useMemo(() => (step / 3) * 100, [step]);

  const isStepComplete = useMemo(() => {
    if (step === 1) return primaryGoal.length > 0;
    if (step === 2) return experienceLevel.length > 0;
    return availableEquipment.length > 0;
  }, [availableEquipment.length, experienceLevel.length, primaryGoal.length, step]);

  const toggleEquipment = (item: string, checked: boolean) => {
    setAvailableEquipment((prev) => {
      if (checked) return prev.includes(item) ? prev : [...prev, item];
      return prev.filter((x) => x !== item);
    });
  };

  const onNext = () => {
    if (!isStepComplete) return;
    setError(null);
    setStep((s) => (s === 1 ? 2 : 3));
  };

  const onBack = () => {
    setError(null);
    setStep((s) => (s === 3 ? 2 : 1));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStepComplete || isPending) return;
    setError(null);

    startTransition(async () => {
      const res = await saveOnboardingProfile({
        primaryGoal,
        experienceLevel,
        availableEquipment,
      });
      if (res?.error) setError(res.error);
    });
  };

  return (
    <>
      <AppNav />
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-[500px]">
          <CardHeader className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl">Welcome</CardTitle>
                <span className="text-sm text-muted-foreground">
                  Step {step} of 3
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <CardDescription>
              Answer a few quick questions so we can personalize your workout plan.
            </CardDescription>
          </CardHeader>

        <form onSubmit={onSubmit}>
          <CardContent className="space-y-6">
            {step === 1 && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">Primary fitness goal</h2>
                  <p className="text-sm text-muted-foreground">
                    Choose what you want to focus on right now.
                  </p>
                </div>

                <RadioGroup value={primaryGoal} onValueChange={setPrimaryGoal}>
                  {GOALS.map((goal) => {
                    const id = `goal-${goal}`;
                    return (
                      <div
                        key={goal}
                        className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent"
                      >
                        <RadioGroupItem id={id} value={goal} />
                        <Label htmlFor={id} className="cursor-pointer">
                          {goal}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">Experience level</h2>
                  <p className="text-sm text-muted-foreground">
                    This helps us set the right difficulty and volume.
                  </p>
                </div>

                <RadioGroup
                  value={experienceLevel}
                  onValueChange={setExperienceLevel}
                >
                  {EXPERIENCE_LEVELS.map((level) => {
                    const id = `exp-${level}`;
                    return (
                      <div
                        key={level}
                        className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent"
                      >
                        <RadioGroupItem id={id} value={level} />
                        <Label htmlFor={id} className="cursor-pointer">
                          {level}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">Available equipment</h2>
                  <p className="text-sm text-muted-foreground">
                    Select all that you have access to (at least one).
                  </p>
                </div>

                <div className="grid gap-2">
                  {EQUIPMENT.map((item) => {
                    const id = `eq-${item}`;
                    const checked = availableEquipment.includes(item);
                    return (
                      <div
                        key={item}
                        className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(v) => toggleEquipment(item, v === true)}
                        />
                        <Label htmlFor={id} className="cursor-pointer">
                          {item}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}
          </CardContent>

          <CardFooter className="flex items-center justify-between gap-3">
            <div>
              {step !== 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onBack}
                  disabled={isPending}
                >
                  Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {step !== 3 ? (
                <Button type="button" onClick={onNext} disabled={!isStepComplete}>
                  Next
                </Button>
              ) : (
                <Button type="submit" disabled={!isStepComplete || isPending}>
                  {isPending ? "Saving..." : "Submit"}
                </Button>
              )}
            </div>
          </CardFooter>
        </form>
        </Card>
      </main>
    </>
  );
}

