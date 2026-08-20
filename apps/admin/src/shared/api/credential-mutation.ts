/**
 * The mutation options a request carrying a **plaintext credential** takes
 * (ADR-0034, amended D3.7; ADR-0033 §The session store).
 *
 * TanStack Query keeps a settled mutation — including the `variables` it was
 * called with — in the mutation cache for `gcTime`, five minutes by default. So
 * without this, a password submitted through `mutateAsync` outlives the dialog
 * that collected it, the `form.reset()` that cleared it and the unmount that
 * removed it, sitting in memory reachable from `queryClient.getMutationCache()`.
 * Nothing reads it; the point is that nothing *can*, which is the same posture
 * ADR-0033 takes towards tokens — keep the window in which a credential exists
 * as narrow as the work requires.
 *
 * **One definition rather than one per entity**, which is the D3.9 review's
 * finding and not tidiness: this had been written three times by the third
 * credential mutation, ADR-0032 forbids one entity importing another's copy,
 * and deleting any of them is silent — the suite stays green while the
 * plaintext sits in the cache. `shared/api` is the layer every entity may
 * reach, and it is where the rule belongs.
 */
export const CREDENTIAL_MUTATION = { gcTime: 0 } as const;
