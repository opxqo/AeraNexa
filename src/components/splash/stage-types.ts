/** What every splash stage gets: the live 0–1 progress (read in its own frame loop) and reduced motion. */
export type StageProps = {
  progressRef: { readonly current: number };
  reduced: boolean;
};
