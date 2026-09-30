export type View =
  | "home"
  | "settings"
  | "solve"
  | "dialogue"
  | "dryRun"
  | "copyQuestions"
  | "requirements"
  | "complete";

export type ActionView = Exclude<View, "home" | "settings">;

export type Navigate = (view: View) => void;
