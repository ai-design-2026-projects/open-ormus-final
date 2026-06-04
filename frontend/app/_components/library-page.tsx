"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CharacterList } from "@/components/characters/CharacterList";
import { CharacterSearch } from "@/components/characters/CharacterSearch";
import { CharacterFormWizard } from "@/components/characters/CharacterFormWizard";
import { CharacterViewDrawer } from "@/components/characters/CharacterViewDrawer";
import { DeleteConfirmDialog } from "@/components/characters/DeleteConfirmDialog";
import { AppNav } from "@/components/app-shell/AppNav";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import type { SavedCharacterRecord, CharacterSaveInput } from "@open-ormus/shared";

export function LibraryPage() {
  const [characters, setCharacters] = useState<SavedCharacterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [wizardInitialStep, setWizardInitialStep] = useState(0);
  const [activeModal, setActiveModal] = useState<
    "create" | "edit" | "view" | "delete" | null
  >(null);
  const [selected, setSelected] = useState<SavedCharacterRecord | null>(null);

  const fetchCharacters = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/characters");
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setFetchError(body.error ?? `Error ${res.status}`);
        return;
      }
      const data = (await res.json()) as SavedCharacterRecord[];
      setCharacters(data);
    } catch {
      setFetchError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCharacters();
  }, [fetchCharacters]);

  const filtered = useMemo(() => {
    const base = searchQuery.trim()
      ? characters.filter(
          (c) =>
            c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (c.sheet as Record<string, unknown>).shortDescription?.toString().toLowerCase().includes(searchQuery.toLowerCase())
        )
      : characters;
    return [...base].sort((a, b) =>
      sortDir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    );
  }, [characters, searchQuery, sortDir]);

  const handleCreate = async (data: CharacterSaveInput): Promise<SavedCharacterRecord> => {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create character");
    const character = (await res.json()) as SavedCharacterRecord;
    await fetchCharacters();
    return character;
  };

  const handleEdit = async (data: CharacterSaveInput): Promise<SavedCharacterRecord> => {
    if (!selected) throw new Error("No character selected");
    const res = await fetch(`/api/characters/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, sheet: data }),
    });
    if (!res.ok) throw new Error("Failed to update character");
    const character = (await res.json()) as SavedCharacterRecord;
    await fetchCharacters();
    return character;
  };


  const handleDelete = async () => {
    if (!selected) return;
    try {
      const res = await fetch(`/api/characters/${selected.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setActiveModal(null);
      setSelected(null);
      await fetchCharacters();
    } catch {
      setDeleteError("Couldn't delete the character. Try again.");
      setActiveModal(null);
    }
  };

  const openView = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("view"); };
  const openEdit = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("edit"); };
  const openDelete = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("delete"); };
  const closeModal = () => { setActiveModal(null); setSelected(null); setDeleteError(null); };

  return (
    <div className="bg-background min-h-screen">
      <AppNav />

      <section className="relative flex items-end justify-between gap-6 px-6 pt-10 pb-6 md:px-14 md:pt-14 md:pb-8 max-w-[1440px] mx-auto">
        <div
          className="absolute pointer-events-none inset-[15px] md:inset-[30px_30px_0_30px]"
          style={{ background: "radial-gradient(700px 300px at 80% 30%, color-mix(in oklch, var(--accent-oo) 9%, transparent), transparent 60%)" }}
        />
        <div className="relative">
          <div className="t-meta">LIBRARY · {characters.length} CHARACTERS</div>
          <h1 className="t-h2 mt-2 mb-0">
            The{" "}<em className="t-editorial">cast</em>{" "}you&apos;ve assembled.
          </h1>
        </div>
        <div className="relative flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => { setWizardInitialStep(0); setActiveModal("create"); }}>Search web</Button>
          <Button variant="default" onClick={() => { setWizardInitialStep(1); setActiveModal("create"); }}>Build with wizard</Button>
        </div>
      </section>

      {fetchError ? (
        <div className="mx-6 md:mx-14 mt-8 rounded-[var(--r-md)] border border-[color-mix(in_oklch,var(--signal-flag)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-flag)_8%,var(--surface-1))] px-4 py-3 text-sm text-signal-flag">
          {fetchError}
        </div>
      ) : (
        <>
          {deleteError && (
            <div className="mx-6 md:mx-14 mt-4 rounded-[var(--r-md)] border border-[color-mix(in_oklch,var(--signal-flag)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-flag)_8%,var(--surface-1))] px-4 py-3 text-sm text-signal-flag">
              {deleteError}
            </div>
          )}
          <section className="border-t border-hair flex items-center justify-between px-6 md:px-14 py-3 gap-4 max-w-[1440px] mx-auto">
            <span className="t-mono text-xs text-ink-mute">{characters.length} characters</span>
            <div className="flex items-center gap-2.5">
              <CharacterSearch onSearch={setSearchQuery} />
              <IconButton variant="bordered" aria-label={sortDir === "asc" ? "Sort Z→A" : "Sort A→Z"} onClick={() => setSortDir((d) => d === "asc" ? "desc" : "asc")}><ArrowUpDown /></IconButton>
            </div>
          </section>
          <section className="px-6 md:px-14 py-8 max-w-[1440px] mx-auto">
            <CharacterList characters={filtered} loading={loading} onView={openView} onEdit={openEdit} onDelete={openDelete} />
          </section>
        </>
      )}

      {activeModal === "create" && <CharacterFormWizard mode="create" initialStep={wizardInitialStep} onSubmit={handleCreate} onClose={closeModal} />}
      {activeModal === "edit" && selected && <CharacterFormWizard mode="edit" initialData={selected} onSubmit={handleEdit} onClose={closeModal} />}
      {activeModal === "view" && selected && <CharacterViewDrawer character={selected} onClose={closeModal} />}
      {activeModal === "delete" && selected && <DeleteConfirmDialog characterName={selected.name} onConfirm={handleDelete} onCancel={closeModal} />}
    </div>
  );
}
