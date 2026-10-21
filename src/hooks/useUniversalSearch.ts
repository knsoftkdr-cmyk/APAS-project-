import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  DEBOUNCE_MS,
  RESULTS_PER_CATEGORY,
  categoriesForRole,
  describeSearchError,
  groupByCategory,
  isSearchable,
  mapRows,
  normalizeQuery,
  type SearchCategory,
  type SearchResult,
} from "@/lib/universalSearch";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Live, debounced, cancellable universal search.
 *
 * - The only request is the `universal_search` RPC, called with the signed-in
 *   user's own Supabase session. The client sends the query text and an optional
 *   category list - never a user id, role or school id.
 * - React Query keys each request by user + query + category, so a response for
 *   an older query can never be rendered for a newer one, and the in-flight
 *   request for a superseded query is aborted.
 */
export function useUniversalSearch(enabled: boolean) {
  const { user, profile } = useAuth();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory | "all">("all");

  const normalized = normalizeQuery(query);
  const debounced = useDebounced(normalized, DEBOUNCE_MS);
  const canSearch = isSearchable(debounced);
  const wantsSearch = isSearchable(normalized);
  // The input has changed but the debounce has not fired yet.
  const isTyping = normalized !== debounced;

  const availableCategories = useMemo(() => categoriesForRole(profile?.role), [profile?.role]);

  const q = useQuery({
    queryKey: ["universal-search", user?.id ?? null, debounced, category],
    enabled: enabled && !!user && canSearch,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<SearchResult[]> => {
      const { data, error } = await (supabase as any)
        .rpc("universal_search", {
          p_query: debounced,
          p_categories: category === "all" ? null : [category],
          p_limit: RESULTS_PER_CATEGORY,
        })
        .abortSignal(signal);
      if (error) throw error;
      return mapRows(data);
    },
  });

  // Results only count if they belong to what the user is currently looking at.
  const results = canSearch && !isTyping && q.data ? q.data : [];

  return {
    query,
    setQuery,
    category,
    setCategory,
    availableCategories,
    canSearch,
    wantsSearch,
    isTyping,
    isSearching: enabled && wantsSearch && (isTyping || q.isFetching),
    isError: q.isError && !isTyping,
    errorMessage: q.isError ? describeSearchError(q.error) : "",
    retry: () => void q.refetch(),
    results,
    groups: groupByCategory(results),
    hasSearched: canSearch && !isTyping && (q.isSuccess || q.isError),
  };
}
