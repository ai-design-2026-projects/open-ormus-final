"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  onSearch: (query: string) => void;
}

export function CharacterSearch({ onSearch }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), 300);
    return () => clearTimeout(timer);
  }, [value, onSearch]);

  return (
    <div className="relative w-56 transition-[width] duration-[180ms] focus-within:w-72">
      <Search strokeWidth={1.5} className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint pointer-events-none z-10" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Filter by name, trait…"
        className="pl-8 w-full"
      />
    </div>
  );
}
