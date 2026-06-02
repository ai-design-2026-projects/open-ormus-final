"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type {
  CharacterSaveInput,
  CharacterPersonality,
  CharacterSearchResult,
  SavedCharacterRecord,
} from "@open-ormus/shared";
import { ImportStep } from "./ImportStep";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─── Form State ───────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type FormState = {
  name: string;
  shortDescription: string;
  imageUrl: string;
  firstAppearanceDate: string;
  personalityTraits: string[];
  backstory: string;
  speechPatterns: string[];
  values: string[];
  fears: string[];
  goals: string[];
  notableQuotes: string[];
  abilities: string[];
  copingStyle: string[];
  relationships: KVPair[];
  knowledgeScope: KVPair[];
};

function emptyForm(): FormState {
  return {
    name: "",
    shortDescription: "",
    imageUrl: "",
    firstAppearanceDate: "",
    personalityTraits: [],
    backstory: "",
    speechPatterns: [],
    values: [],
    fears: [],
    goals: [],
    notableQuotes: [],
    abilities: [],
    copingStyle: [],
    relationships: [],
    knowledgeScope: [],
  };
}

function fromRecord(record: SavedCharacterRecord): FormState {
  const { sheet } = record;
  const p = sheet.personality;
  return {
    name: sheet.name,
    shortDescription: sheet.shortDescription,
    imageUrl: sheet.imageUrl ?? "",
    firstAppearanceDate: sheet.firstAppearanceDate ?? "",
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({
      key,
      value: String(value),
    })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({
      key,
      value: String(value),
    })),
  };
}

function fromSearchResult(result: CharacterSearchResult): FormState {
  const p = result.personality;
  return {
    name: result.name,
    shortDescription: result.shortDescription,
    imageUrl: result.imageUrl ?? "",
    firstAppearanceDate: result.firstAppearanceDate ?? "",
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({ key, value })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({ key, value })),
  };
}

function toSaveInput(state: FormState): CharacterSaveInput {
  const personality: CharacterPersonality = {
    personalityTraits: state.personalityTraits,
    backstory: state.backstory,
    speechPatterns: state.speechPatterns,
    values: state.values,
    fears: state.fears,
    goals: state.goals,
    notableQuotes: state.notableQuotes,
    abilities: state.abilities,
    copingStyle: state.copingStyle,
    relationships: Object.fromEntries(
      state.relationships.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
    knowledgeScope: Object.fromEntries(
      state.knowledgeScope.filter((r) => r.key.trim()).map((r) => [r.key, r.value])
    ),
  };
  return {
    name: state.name,
    shortDescription: state.shortDescription,
    imageUrl: state.imageUrl.trim() || null,
    firstAppearanceDate: state.firstAppearanceDate,
    personality,
  };
}

// ─── FieldLabel ────────────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block t-meta text-ink-dim mb-1">
      {children}
      {required && <span className="text-signal-flag ml-0.5">*</span>}
    </label>
  );
}

// ─── TagInput ──────────────────────────────────────────────────────────────────

function TagInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
      setDraft("");
    }
  };

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2 mb-2">
        <Input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1"
          placeholder="Type and press Enter or Add"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add
        </Button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={i}
              className="flex items-center gap-1 t-meta bg-surface-sunk text-ink-dim border border-hair rounded-[6px] px-2 py-1"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="text-ink-faint hover:text-ink-dim"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KVEditor ─────────────────────────────────────────────────────────────────

function KVEditor({
  label,
  pairs,
  onChange,
}: {
  label: string;
  pairs: KVPair[];
  onChange: (p: KVPair[]) => void;
}) {
  const add = () => onChange([...pairs, { key: "", value: "" }]);
  const remove = (i: number) => onChange(pairs.filter((_, j) => j !== i));
  const update = (i: number, field: "key" | "value", v: string) =>
    onChange(pairs.map((p, j) => (j === i ? { ...p, [field]: v } : p)));

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input
              type="text"
              value={pair.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="Key"
              className="w-32"
            />
            <Input
              type="text"
              value={pair.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="Value"
              className="flex-1"
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Remove entry"
              onClick={() => remove(i)}
            >
              <X className="size-3.5" strokeWidth={1.5} />
            </IconButton>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={add}>
          + Add entry
        </Button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const FORM_STEPS = ["Basics", "Personality", "Connections"] as const;

// In create mode: step 0 = Import, steps 1-3 = FORM_STEPS.
// In edit mode:   steps 0-2 = FORM_STEPS.
const CREATE_STEPS = ["Import", ...FORM_STEPS] as const;

interface WizardProps {
  mode: "create" | "edit";
  initialData?: SavedCharacterRecord;
  initialStep?: number;
  onSubmit: (data: CharacterSaveInput) => Promise<void>;
  onClose: () => void;
}

export function CharacterFormWizard({
  mode,
  initialData,
  initialStep,
  onSubmit,
  onClose,
}: WizardProps) {
  const [step, setStep] = useState(initialStep ?? 0);
  const [form, setForm] = useState<FormState>(() =>
    initialData ? fromRecord(initialData) : emptyForm()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Queue state for multi-character imports
  const [pendingQueue, setPendingQueue] = useState<CharacterSearchResult[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // formStep is the index into FORM_STEPS (0=Basics, 1=Personality, 2=Connections).
  // In create mode, step 0 is Import, so formStep = step - 1.
  // In edit mode, formStep = step directly.
  const formStep = mode === "create" ? step - 1 : step;
  const displaySteps = mode === "create" ? CREATE_STEPS : FORM_STEPS;
  const isImportStep = mode === "create" && step === 0;
  const isLastFormStep = formStep === FORM_STEPS.length - 1;

  // Called by ImportStep when user confirms import selection
  const handleImported = (results: CharacterSearchResult[]) => {
    if (results.length === 0) return;
    const [first, ...rest] = results;
    setForm(fromSearchResult(first!));
    setPendingQueue(rest);
    setQueueTotal(results.length);
    setStep(mode === "create" ? 1 : 0); // advance to Basics
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toSaveInput(form));
      onClose();
    } catch {
      setError("Failed to save character. Please try again.");
      setSubmitting(false);
    }
  };

  const handleSaveAndNext = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(toSaveInput(form));
      if (pendingQueue.length > 0) {
        const [next, ...rest] = pendingQueue;
        setForm(fromSearchResult(next!));
        setPendingQueue(rest);
        setStep(mode === "create" ? 1 : 0); // back to Basics for next character
      } else {
        onClose();
      }
    } catch {
      setError("Failed to save character. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setForm(fromSearchResult(next!));
      setPendingQueue(rest);
      setStep(mode === "create" ? 1 : 0);
      setError(null);
    } else {
      onClose();
    }
  };

  const queuePosition = queueTotal - pendingQueue.length; // 1-based index of current char

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-panel/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-hair rounded-[var(--r-xl)] shadow-[var(--shadow-3)] w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-hair">
          <h2 className="t-h6">
            {mode === "create" ? "New Character" : "Edit Character"}
          </h2>
          <IconButton variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X strokeWidth={1.5} className="size-4" />
          </IconButton>
        </div>

        {/* Step indicator */}
        <div className="px-7 py-3 border-b border-hair flex gap-1 bg-surface-sunk">
          {displaySteps.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (mode === "create" && i === 0) return;
                if (i <= step) setStep(i);
              }}
              className={`px-3 py-1.5 text-[12.5px] font-medium rounded-[8px] transition-all duration-[120ms] ${
                i === step
                  ? "bg-ink-panel text-on-ink shadow-[var(--shadow-1)]"
                  : i < step
                  ? "text-ink-dim hover:text-ink cursor-pointer"
                  : "text-ink-faint cursor-default"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-5">
          {/* Import step — create mode only */}
          {isImportStep && (
            <ImportStep onImported={handleImported} />
          )}

          {/* Form steps */}
          {!isImportStep && (
            <>
              {formStep === 0 && (
                <>
                  <div>
                    <FieldLabel required>Name</FieldLabel>
                    <Input
                      type="text"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>Short Description</FieldLabel>
                    <Textarea
                      value={form.shortDescription}
                      onChange={(e) => set("shortDescription", e.target.value)}
                      rows={3}
                    />
                  </div>
                  <div>
                    <FieldLabel>Image URL</FieldLabel>
                    <Input
                      type="text"
                      value={form.imageUrl}
                      onChange={(e) => set("imageUrl", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel>First Appearance Date</FieldLabel>
                    <Input
                      type="text"
                      value={form.firstAppearanceDate}
                      onChange={(e) => set("firstAppearanceDate", e.target.value)}
                      placeholder="e.g. 2013-09-22 or 0000-01-01 if unknown"
                    />
                  </div>
                </>
              )}

              {formStep === 1 && (
                <>
                  <TagInput
                    label="Personality Traits"
                    values={form.personalityTraits}
                    onChange={(v) => set("personalityTraits", v)}
                  />
                  <div>
                    <FieldLabel>Backstory</FieldLabel>
                    <Textarea
                      value={form.backstory}
                      onChange={(e) => set("backstory", e.target.value)}
                      rows={4}
                    />
                  </div>
                  <TagInput
                    label="Speech Patterns"
                    values={form.speechPatterns}
                    onChange={(v) => set("speechPatterns", v)}
                  />
                  <TagInput
                    label="Values"
                    values={form.values}
                    onChange={(v) => set("values", v)}
                  />
                  <TagInput
                    label="Fears"
                    values={form.fears}
                    onChange={(v) => set("fears", v)}
                  />
                  <TagInput
                    label="Goals"
                    values={form.goals}
                    onChange={(v) => set("goals", v)}
                  />
                  <TagInput
                    label="Notable Quotes"
                    values={form.notableQuotes}
                    onChange={(v) => set("notableQuotes", v)}
                  />
                  <TagInput
                    label="Abilities"
                    values={form.abilities}
                    onChange={(v) => set("abilities", v)}
                  />
                  <TagInput
                    label="Coping Style"
                    values={form.copingStyle}
                    onChange={(v) => set("copingStyle", v)}
                  />
                </>
              )}

              {formStep === 2 && (
                <>
                  <KVEditor
                    label="Relationships (name → description)"
                    pairs={form.relationships}
                    onChange={(p) => set("relationships", p)}
                  />
                  <KVEditor
                    label="Knowledge Scope (topic → scope)"
                    pairs={form.knowledgeScope}
                    onChange={(p) => set("knowledgeScope", p)}
                  />
                </>
              )}

              {error && <p className="t-body-s text-signal-flag">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-hair px-7 py-5 flex items-center justify-between">
          {/* Left button */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          {/* Right area */}
          {isImportStep ? (
            // Import step: offer manual entry escape hatch
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
            >
              Enter manually →
            </Button>
          ) : !isLastFormStep ? (
            // Form steps — not last
            <Button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={formStep === 0 && !form.name.trim()}
            >
              Next
            </Button>
          ) : pendingQueue.length > 0 ? (
            // Last form step with pending queue
            <div className="flex items-center gap-3">
              {queueTotal > 1 && (
                <span className="t-meta text-ink-faint">
                  Character {queuePosition} of {queueTotal}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={handleSkip}
                disabled={submitting}
              >
                Skip
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveAndNext()}
                disabled={submitting || !form.name.trim()}
              >
                {submitting ? "Saving…" : "Save & Next"}
              </Button>
            </div>
          ) : (
            // Last form step, no queue — normal save
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !form.name.trim()}
            >
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save Changes"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
