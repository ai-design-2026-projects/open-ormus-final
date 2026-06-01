"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CharacterList } from "@/components/characters/CharacterList";
import { CharacterSearch } from "@/components/characters/CharacterSearch";
import { CharacterFormWizard } from "@/components/characters/CharacterFormWizard";
import { CharacterViewDrawer } from "@/components/characters/CharacterViewDrawer";
import { DeleteConfirmDialog } from "@/components/characters/DeleteConfirmDialog";
import { AppNav } from "@/components/app-shell/AppNav";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import type { SavedCharacterRecord, CharacterSaveInput } from "@open-ormus/shared";

export function LibraryPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<SavedCharacterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
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

  const handleCreate = async (data: CharacterSaveInput) => {
    const res = await fetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to create character");
    await fetchCharacters();
  };

  const handleEdit = async (data: CharacterSaveInput) => {
    if (!selected) return;
    const res = await fetch(`/api/characters/${selected.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, sheet: data }),
    });
    if (!res.ok) throw new Error("Failed to update character");
    await fetchCharacters();
  };

  const handleDelete = async () => {
    if (!selected) return;
    const res = await fetch(`/api/characters/${selected.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete character");
    setActiveModal(null);
    setSelected(null);
    await fetchCharacters();
  };

  const openView = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("view"); };
  const openEdit = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("edit"); };
  const openDelete = (c: SavedCharacterRecord) => { setSelected(c); setActiveModal("delete"); };
  const closeModal = () => { setActiveModal(null); setSelected(null); };

  return (
    <div className="bg-background min-h-screen">
      <AppNav />

      <section className="relative flex flex-col gap-8 px-6 pt-10 pb-6 md:grid md:grid-cols-[1fr_420px] md:gap-12 md:px-14 md:pt-14 md:pb-8 md:items-end max-w-[1440px] mx-auto">
        <div
          className="absolute pointer-events-none inset-[15px] md:inset-[30px_30px_0_30px]"
          style={{ background: "radial-gradient(700px 300px at 80% 30%, color-mix(in oklch, var(--accent-oo) 9%, transparent), transparent 60%)" }}
        />
        <div className="relative">
          <div className="t-meta">LIBRARY · {characters.length} CHARACTERS</div>
          <h1 className="t-h2 mt-2 mb-0">
            The <em className="t-editorial">cast</em> you&apos;ve assembled.
          </h1>
          <p className="t-body-l text-ink-dim max-w-[560px] mt-3.5">
            Import them from the open web, or build them from scratch with the wizard.
            When you&apos;re ready, put any two — or up to ten — into a scene.
          </p>
        </div>
        <div className="relative flex flex-col gap-3">
          <div className="glass rounded-[var(--r-lg)] p-5">
            <div className="t-meta t-meta-bright">QUICK START</div>
            <div className="t-h6 mt-1 mb-0">Start a scene</div>
            <div className="t-body-s text-ink-dim mt-1 mb-4">Pick two characters · describe the setting</div>
            <Button variant="default" className="w-full" onClick={() => router.push("/conversations")}>Open stage</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setWizardInitialStep(0); setActiveModal("create"); }}>Import public</Button>
            <Button variant="default" className="flex-1" onClick={() => { setWizardInitialStep(1); setActiveModal("create"); }}>Build with wizard</Button>
          </div>
        </div>
      </section>

      {fetchError ? (
        <div className="mx-6 md:mx-14 mt-8 rounded-[var(--r-md)] border border-[color-mix(in_oklch,var(--signal-flag)_30%,transparent)] bg-[color-mix(in_oklch,var(--signal-flag)_8%,var(--surface-1))] px-4 py-3 text-sm text-signal-flag">
          {fetchError}
        </div>
      ) : (
        <>
          <section className="border-t border-b border-hair bg-surface-1 flex items-center justify-between px-6 md:px-14 py-4 gap-4 max-w-[1440px] mx-auto">
            <div className="flex items-center gap-2">
              <Chip active>All · {characters.length}</Chip>
              <Chip tabIndex={-1}>Public</Chip>
              <Chip tabIndex={-1}>Personal</Chip>
              <Chip tabIndex={-1}>Drafts</Chip>
            </div>
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
