/**
 * Allergy check for prescriptions. Matches a drug against the patient's recorded allergies by
 * name and by common drug class (an allergy to "penicillin" flags amoxicillin).
 */
const CLASSES: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'amoxycillin', 'ampicillin', 'cloxacillin', 'piperacillin', 'augmentin', 'amoxiclav', 'clavam', 'mox'],
  cephalosporin: ['cef', 'ceph'],
  sulfa: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septran', 'bactrim'],
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'aceclofenac', 'ketorolac', 'mefenamic', 'piroxicam', 'etoricoxib', 'nimesulide', 'brufen', 'combiflam', 'voveran'],
  aspirin: ['aspirin', 'ecosprin', 'disprin'],
  quinolone: ['floxacin', 'ciplox'],
  macrolide: ['azithromycin', 'clarithromycin', 'erythromycin', 'azithral'],
  tetracycline: ['tetracycline', 'doxycycline', 'minocycline'],
  opioid: ['morphine', 'codeine', 'tramadol', 'fentanyl', 'pethidine', 'tapentadol'],
  paracetamol: ['paracetamol', 'acetaminophen', 'crocin', 'dolo', 'calpol'],
};

const IGNORE = new Set(['nkda', 'nka', 'none', 'nil', 'no known allergies', 'na', '-']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 -]/g, ' ').trim();

/** Returns the first allergy the drug matches, or null. */
export function matchAllergies(allergies: string[], names: (string | null | undefined)[]): string | null {
  const drugs = names.filter((n): n is string => !!n).map(norm);
  for (const raw of allergies) {
    const a = norm(raw);
    if (!a || IGNORE.has(a)) continue;
    const key = Object.keys(CLASSES).find((k) => a.includes(k) || k.includes(a.replace(/s$/, '')));
    const needles = key ? [a, ...CLASSES[key]!] : [a];
    for (const d of drugs) {
      if (needles.some((n) => n.length >= 3 && (d.includes(n) || (d.length >= 4 && n.includes(d))))) return raw;
    }
  }
  return null;
}
