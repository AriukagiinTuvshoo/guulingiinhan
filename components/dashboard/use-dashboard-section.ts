"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
export type SectionData<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  retry: () => void;
};
export function useDashboardSection<T>(path: string): SectionData<T> {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ path, data: null, loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ path, data: null, loading: true, error: "" });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, loading: false, error: "" });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401)
          router.replace("/login");
        setState({
          path,
          data: null,
          loading: false,
          error:
            cause instanceof ApiError && cause.status === 403
              ? "Энэ хэсгийг үзэх эрхгүй байна."
              : "Энэ хэсгийг одоогоор ачаалж чадсангүй.",
        });
      });
    return () => controller.abort();
  }, [path, attempt, router]);
  return {
    ...(state.path === path ? state : { data: null, loading: true, error: "" }),
    retry: () => setAttempt((value) => value + 1),
  };
}
