"use client";

import { useState } from "react";
import type {
  CharacterSaveInput,
  CharacterPersonality,
  SavedCharacterRecord,
} from "@open-ormus/shared";

// ─── Form State ──────────────────────────────────────────────────────────────

type KVPair = { key: string; value: string };

type FormState = {
  name: string;
  shortDescription: string;
  imageUrl: string;
  firstAppearanceDate: string;
  confidence: 0 | 1 | 2 | 3;
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
    confidence: 3,
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
    firstAppearanceDate: sheet.firstAppearanceDate,
    confidence: sheet.confidence,
    personalityTraits: p.personalityTraits,
    backstory: p.backstory,
    speechPatterns: p.speechPatterns,
    values: p.values,
    fears: p.fears,
    goals: p.goals,
    notableQuotes: p.notableQuotes,
    abilities: p.abilities,
    copingStyle: p.copingStyle,
    relationships: Object.entries(p.relationships).map(([key, value]) => ({ key, value: String(value) })),
    knowledgeScope: Object.entries(p.knowledgeScope).map(([key, value]) => ({ key, value: String(value) })),
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
    confidence: state.confidence,
    personality,
  };
}

// ─── TagInput ─────────────────────────────────────────────────────────────────

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
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
          placeholder="Type and press Enter or Add"
        />
        <button
          type="button"
          onClick={add}
          className="px-3 py-1.5 text-sm bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors"
        >
          Add
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={i}
              className="flex items-center gap-1 text-xs bg-zinc-100 text-zinc-700 px-2 py-1 rounded-full"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="text-zinc-400 hover:text-zinc-600"
              >
                &times;
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
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => update(i, "key", e.target.value)}
              placeholder="Key"
              className="w-32 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <input
              type="text"
              value={pair.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder="Value"
              className="flex-1 px-3 py-1.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-zinc-400 hover:text-red-500 text-lg leading-none"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="text-sm text-zinc-500 hover:text-zinc-800 underline"
        >
          + Add entry
        </button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const STEPS = ["Basics", "Personality", "Connections"] as const;

interface WizardProps {
  mode: "create" | "edit";
  initialData?: SavedCharacterRecord;
  onSubmit: (data: CharacterSaveInput) => Promise<void>;
  onClose: () => void;
}

export function CharacterFormWizard({
  mode,
  initialData,
  onSubmit,
  onClose,
}: WizardProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(() =>
    initialData ? fromRecord(initialData) : emptyForm()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            {mode === "create" ? "New Character" : "Edit Character"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-zinc-100 flex gap-6">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(i)}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                i === step
                  ? "border-zinc-900 text-zinc-900"
                  : i < step
                  ? "border-zinc-300 text-zinc-500"
                  : "border-transparent text-zinc-300"
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {step === 0 && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Short Description
                </label>
                <textarea
                  value={form.shortDescription}
                  onChange={(e) => set("shortDescription", e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Image URL</label>
                <input
                  type="text"
                  value={form.imageUrl}
                  onChange={(e) => set("imageUrl", e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  First Appearance Date
                </label>
                <input
                  type="text"
                  value={form.firstAppearanceDate}
                  onChange={(e) => set("firstAppearanceDate", e.target.value)}
                  placeholder="e.g. 2013-09-22 or 0000-01-01 if unknown"
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Confidence</label>
                <select
                  value={form.confidence}
                  onChange={(e) => set("confidence", Number(e.target.value) as 0 | 1 | 2 | 3)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400 bg-white"
                >
                  <option value={0}>0 — Unknown</option>
                  <option value={1}>1 — Low</option>
                  <option value={2}>2 — Medium</option>
                  <option value={3}>3 — High</option>
                </select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <TagInput
                label="Personality Traits"
                values={form.personalityTraits}
                onChange={(v) => set("personalityTraits", v)}
              />
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Backstory</label>
                <textarea
                  value={form.backstory}
                  onChange={(e) => set("backstory", e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              </div>
              <TagInput
                label="Speech Patterns"
                values={form.speechPatterns}
                onChange={(v) => set("speechPatterns", v)}
              />
              <TagInput label="Values" values={form.values} onChange={(v) => set("values", v)} />
              <TagInput label="Fears" values={form.fears} onChange={(v) => set("fears", v)} />
              <TagInput label="Goals" values={form.goals} onChange={(v) => set("goals", v)} />
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

          {step === 2 && (
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

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 flex justify-between">
          <button
            type="button"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !form.name.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : mode === "create" ? "Create" : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
