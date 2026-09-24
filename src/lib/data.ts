// Pre-computed datasets live in public/data/<theme>/<department>.<ext>, built by scripts/.
// One file per department keeps each download small and the repository's file count low.

/** INSEE commune code → department code (overseas departments have 3 digits). */
export const departmentOf = (insee: string) => (insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2));

/** URL of a pre-computed file, honouring the GitHub Pages base path. */
export const dataUrl = (theme: string, dep: string, ext = 'json') =>
  `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data/${theme}/${dep}.${ext}`;
