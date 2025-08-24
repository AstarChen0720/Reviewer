import type { Block } from '../types';

export interface SamplingOptions {
  totalWanted?: number; // default 10
  overrideBox1?: number; // if undefined use default ratio / computed
  overrideBox2?: number;
  overrideBox3?: number;
  defaultRatio?: { box1: number; box2: number; box3: number }; // default {4,4,2}
  dedupeByText?: boolean; // keep only first id per unique text (default false)
}

export interface SamplingResult {
  selected: Block[]; // concatenated in order box1, box2, box3
  counts: { box1: number; box2: number; box3: number; total: number };
  shortage: boolean; // true if total available < target totalWanted
  detail: string; // debug explanation
}

// Fisher-Yates in-place
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function sampleForLanguage(all: Block[], lang: 'ja'|'en', opts: SamplingOptions = {}): SamplingResult {
  const defaultRatio = opts.defaultRatio || { box1: 4, box2: 4, box3: 2 };
  const totalWanted = opts.totalWanted ?? (defaultRatio.box1 + defaultRatio.box2 + defaultRatio.box3);
  const overrides: Partial<Record<'box1'|'box2'|'box3', number>> = {
    box1: opts.overrideBox1,
    box2: opts.overrideBox2,
    box3: opts.overrideBox3,
  };

  // Filter by language and allowed boxes
  let pool = all.filter(b => b.lang === lang && (b.box === 'box1' || b.box === 'box2' || b.box === 'box3'));
  if (opts.dedupeByText) {
    const seen = new Set<string>();
    pool = pool.filter(b => {
      if (seen.has(b.text)) return false; seen.add(b.text); return true;
    });
  }
  const groups = {
    box1: pool.filter(b => b.box === 'box1'),
    box2: pool.filter(b => b.box === 'box2'),
    box3: pool.filter(b => b.box === 'box3'),
  } as const;

  // Step 1: start with base (overrides or default ratio)
  const targets: Record<'box1'|'box2'|'box3', number> = {
    box1: overrides.box1 ?? defaultRatio.box1,
    box2: overrides.box2 ?? defaultRatio.box2,
    box3: overrides.box3 ?? defaultRatio.box3,
  };

  // Sum current targets
  let currentSum = targets.box1 + targets.box2 + targets.box3;
  let log: string[] = [];
  log.push(`Initial targets: ${JSON.stringify(targets)}, sum=${currentSum}, totalWanted=${totalWanted}`);

  // If overrides present and sum differs from totalWanted adjust:
  if (currentSum !== totalWanted) {
    if (currentSum < totalWanted) {
      // Distribute remaining across boxes in order box1->box2->box3 until match
      let remain = totalWanted - currentSum;
      const order: ('box1'|'box2'|'box3')[] = ['box1','box2','box3'];
      while (remain > 0) {
        for (const k of order) {
          if (remain === 0) break;
          // If user explicitly overrode this box and all other boxes also overridden we still add; else always add (simpler rule aligning with spec: 按順序補)
          targets[k] += 1; remain -= 1;
        }
      }
      log.push(`Distributed remaining to reach totalWanted: ${JSON.stringify(targets)}`);
    } else if (currentSum > totalWanted) {
      // Reduce from lowest priority? spec not strict; choose from box3 backwards box3->box2->box1
      let over = currentSum - totalWanted;
      const order: ('box3'|'box2'|'box1')[] = ['box3','box2','box1'];
      while (over > 0) {
        for (const k of order) {
          if (over === 0) break;
            if (targets[k] > 0) { targets[k] -= 1; over -= 1; }
        }
      }
      log.push(`Reduced to meet totalWanted: ${JSON.stringify(targets)}`);
    }
  }

  // Handle shortages per box
  const available = { box1: groups.box1.length, box2: groups.box2.length, box3: groups.box3.length };
  log.push(`Available: ${JSON.stringify(available)}`);
  let shortfall = 0;
  (['box1','box2','box3'] as const).forEach(k => {
    if (targets[k] > available[k]) {
      shortfall += targets[k] - available[k];
      targets[k] = available[k];
    }
  });
  if (shortfall) log.push(`Shortfall after capping: ${shortfall}, capped targets=${JSON.stringify(targets)}`);

  if (shortfall) {
    // Redistribute shortfall to boxes still having capacity
    const order: ('box1'|'box2'|'box3')[] = ['box1','box2','box3'];
    for (const k of order) {
      if (shortfall === 0) break;
      const cap = available[k] - targets[k];
      if (cap <= 0) continue;
      const add = Math.min(cap, shortfall);
      targets[k] += add;
      shortfall -= add;
    }
    if (shortfall) log.push(`Remaining shortfall not fillable: ${shortfall}`);
  }

  // Final selection
  const selected: Block[] = [];
  (['box1','box2','box3'] as const).forEach(k => {
    const arr = [...groups[k]];
    shuffle(arr);
    selected.push(...arr.slice(0, targets[k]));
  });

  const totalSelected = selected.length;
  const shortage = totalSelected < totalWanted;
  if (shortage) log.push(`Total selected ${totalSelected} < totalWanted ${totalWanted}`);

  return {
    selected,
    counts: { box1: targets.box1, box2: targets.box2, box3: targets.box3, total: totalSelected },
    shortage,
    detail: log.join('\n')
  };
}
