/**
 * Hand-authored heights for Villanova halls.
 *
 * OSM `height` / `building:levels` win when they are present and plausible.
 * A citation overrides a tag only when the tag cannot describe the building
 * (the pavilion's 13.9 m tag on a 7,000 m² arena). Untagged major halls use
 * this table instead of one campus-wide default.
 */

export const FLOOR_H = 3.45;
export const PARAPET = 1.2;

/** @type {{ match: RegExp, h?: number, nave?: number, spire?: number, fam?: string, overrideOsm?: boolean, why?: string }[]} */
export const HEIGHT_RULES = [
  { match: /^st\. thomas of villanova church$/, nave: 16.5, spire: 30.06, fam: 'gothic' },
  {
    match: /^finneran pavilion$/,
    h: 24,
    fam: 'arena',
    overrideOsm: true,
    why: 'OSM height 13.9 m is a shed on a 7,000 m² arena; the bowl reads at 24 m',
  },
  { match: /^falvey memorial library$/, h: 20, fam: 'library' },
  { match: /^old falvey hall$/, h: 16, fam: 'stone' },
  { match: /^connelly center$/, h: 14, fam: 'center' },
  { match: /^mendel hall$/, h: 18, fam: 'stone' },
  { match: /^tolentine hall$/, h: 16.5, fam: 'gothic' },
  { match: /^bartley hall$/, h: 18, fam: 'stone' },
  { match: /^garey hall$/, h: 16, fam: 'gothic' },
  { match: /^charles widger school of law$/, h: 16, fam: 'glass' },
  { match: /^alumni hall$/, h: 13.5, fam: 'gothic' },
  { match: /^villanova station$/, h: 8, fam: 'station' },
  { match: /^dougherty hall$/, h: 15, fam: 'stone' },
  { match: /^corr hall$/, h: 14.5, fam: 'gothic' },
  { match: /^vasey hall$/, h: 14, fam: 'stone' },
  { match: /mullen center/i, h: 14, fam: 'stone' },
  { match: /^driscoll hall$/, h: 16, fam: 'stone' },
  { match: /center for engineering/i, h: 18, fam: 'glass' },
  { match: /^john barry hall$/, h: 16, fam: 'stone' },
  { match: /^white hall$/, h: 14, fam: 'stone' },
  { match: /davis center/i, h: 14, fam: 'arena' },
  { match: /talley athletic/i, h: 12, fam: 'arena' },
  { match: /monastery$/i, h: 12, fam: 'gothic' },
  { match: /garage/i, h: 15, fam: 'concrete' },
  { match: /chemical engineering/i, h: 12, fam: 'stone' },
  { match: /structural engineering/i, h: 11, fam: 'concrete' },
  { match: /steam plant/i, h: 10, fam: 'concrete' },
  { match: /greenhouse/i, h: 6, fam: 'glass' },
  {
    match: /(stanford|donahue|good counsel|mcguire|saint monica|katharine|caughlin|fedigan|sheehan|sullivan|austin|kennedy|jackson|gallen|farley|klekotka|welsh|saint clare|rudolph|moulden|delurey|o'dwyer|middleton|simpson|farrell|geraghty|moriarity|burns|stone hall)/i,
    h: 15,
    fam: 'brick',
  },
];

export function matchHeightRule(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return HEIGHT_RULES.find((rule) => rule.match.test(n)) || null;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ n?: string, h?: number, hs?: string, fam?: string, kind?: string }} building
 */
export function resolveBuilding(building) {
  const rule = matchHeightRule(building.n);
  const tagged = building.hs === 'height' || building.hs === 'levels';
  let h = building.h;
  let fam = building.fam || 'stone';
  let hs = building.hs || 'default';
  let spire = 0;

  if (rule?.nave) {
    const tip = building.spire || (tagged ? building.h : rule.spire);
    spire = round(Math.max(tip || rule.spire, rule.nave + 10));
    h = rule.nave;
    fam = rule.fam || fam;
    hs = building.spire ? (building.hs || 'authored') : tagged ? 'height' : 'authored';
  } else if (rule?.overrideOsm) {
    h = rule.h;
    fam = rule.fam || fam;
    hs = 'authored';
  } else if (tagged) {
    h = building.h;
    if (rule?.fam) fam = rule.fam;
  } else if (rule?.h) {
    h = rule.h;
    fam = rule.fam || fam;
    hs = 'authored';
  } else if (building.kind === 'dormitory' && (hs === 'default' || !hs)) {
    h = Math.max(h || 0, 14);
    fam = 'brick';
    hs = 'authored';
  } else if (!tagged && (building.kind === 'university' || building.kind === 'college') && (h || 0) < 12) {
    h = 14;
    hs = 'authored';
  }

  return {
    h: round(h || 10),
    fam,
    hs,
    spire: spire ? round(spire) : 0,
    rule: rule?.why || '',
  };
}
