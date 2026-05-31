import { z } from "zod";

export const JudgeOutputSchema = z.object({
  assignments: z.array(
    z.object({
      alias: z.string(),
      real_name: z.string(),
      reasons: z.array(z.string()).min(1),
    }),
  ),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export type JudgeAssignmentResult = {
  alias: string;
  real_name_guessed: string;
  real_name_actual: string;
  correct: boolean;
  reasons: string[];
};

export type JudgeResult = {
  label: "judge_1" | "judge_2" | "judge_3";
  model: string;
  assignments: JudgeAssignmentResult[];
  all_correct: boolean;
};

export type GuessingScenarioResult = {
  scenario_id: string;
  scenario_title: string;
  judges: JudgeResult[];
};
