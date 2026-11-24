"use client";

import { createContext, useContext } from "react";
import type { Family, User } from "../lib/api";

export const FamilyContext = createContext<{
  family: Family | null;
  user: User | null;
  loading: boolean;
  error: string;
  retry: () => void;
}>({ family: null, user: null, loading: true, error: "", retry: () => {} });

export const useFamilyContext = () => useContext(FamilyContext);
