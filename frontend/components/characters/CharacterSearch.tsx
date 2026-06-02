"use client";

import { useState, useEffect } from "react";
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
    <Input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Filter by name, trait…"
      className="w-full max-w-md"
    />
  );
}
