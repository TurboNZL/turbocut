/**
 * One progress number for a model that is several files downloading at once. The library reports each file on its own (0 to 100 %, interleaved),
 * so showing the latest report made the bar jump between two percentages and finish twice. This adds the bytes of every file seen so far and
 * never goes backwards: a file that shows up later (and so adds to the total) holds the bar where it was instead of pulling it back.
 */
export function downloadProgress(): (e: { file?: string; loaded?: number; total?: number; progress?: number; status?: string }) => number | null {
  const files = new Map<string, { loaded: number; total: number }>();
  let shown = 0;
  return (e) => {
    if (!e || !e.file) return null;
    if (e.status === 'done') {
      const f = files.get(e.file);
      if (f) f.loaded = f.total;
    } else if (e.status === 'progress' && typeof e.total === 'number' && e.total > 0 && typeof e.loaded === 'number') {
      files.set(e.file, { loaded: Math.min(e.loaded, e.total), total: e.total });
    } else return null;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) (loaded += f.loaded), (total += f.total);
    if (!total) return null;
    // Never 100 % from here: the last file is not known until it starts, so a finished first file must not read as a finished model. The caller moves on when the model is ready.
    shown = Math.max(shown, Math.min(0.99, loaded / total));
    return shown;
  };
}
