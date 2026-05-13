// frontend/app/page.tsx
"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useMemo } from "react";
import { CharacterList } from "@/components/characters/CharacterList";
import { CharacterSearch } from "@/components/characters/CharacterSearch";
import { CharacterFormWizard } from "@/components/characters/CharacterFormWizard";
import { CharacterViewDrawer } from "@/components/characters/CharacterViewDrawer";
import { DeleteConfirmDialog } from "@/components/characters/DeleteConfirmDialog";
import { logout } from "@/app/(auth)/actions";
import type { SavedCharacterRecord, CharacterSaveInput } from "@open-ormus/shared";

export default function HomePage() {
  const [characters, setCharacters] = useState<SavedCharacterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModal, setActiveModal] = useState<
    "create" | "edit" | "view" | "delete" | null
  >(null);
  const [selected, setSelected] = useState<SavedCharacterRecord | null>(null);

  const fetchCharacters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/characters");
      const data = (await res.json()) as SavedCharacterRecord[];
      setCharacters(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCharacters();
  }, [fetchCharacters]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const q = searchQuery.toLowerCase();
    return characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.sheet.shortDescription.toLowerCase().includes(q)
    );
  }, [characters, searchQuery]);

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

  const openView = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("view");
  };

  const openEdit = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("edit");
  };

  const openDelete = (c: SavedCharacterRecord) => {
    setSelected(c);
    setActiveModal("delete");
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelected(null);
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">OpenOrmus</h1>
        <nav className="flex items-center gap-4">
          <Link
            href="/conversations"
            className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
          >
            Conversations
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-zinc-500 hover:text-zinc-800 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
            >
              Log out
            </button>
          </form>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6 gap-4">
          <CharacterSearch onSearch={setSearchQuery} />
          <button
            type="button"
            onClick={() => setActiveModal("create")}
            className="px-4 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors whitespace-nowrap"
          >
            + New Character
          </button>
        </div>

        <CharacterList
          characters={filtered}
          loading={loading}
          onView={openView}
          onEdit={openEdit}
          onDelete={openDelete}
        />
      </main>

      {activeModal === "create" && (
        <CharacterFormWizard mode="create" onSubmit={handleCreate} onClose={closeModal} />
      )}
      {activeModal === "edit" && selected && (
        <CharacterFormWizard
          mode="edit"
          initialData={selected}
          onSubmit={handleEdit}
          onClose={closeModal}
        />
      )}
      {activeModal === "view" && selected && (
        <CharacterViewDrawer character={selected} onClose={closeModal} />
      )}
      {activeModal === "delete" && selected && (
        <DeleteConfirmDialog
          characterName={selected.name}
          onConfirm={handleDelete}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
