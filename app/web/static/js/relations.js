/** Группы связанных тайтлов в карточке: сначала ТВ, потом фильмы и спешлы, затем всё остальное. */
const GROUPS = [
  { key: "tv", title: "ТВ-сериалы", formats: ["TV", "TV_SHORT"] },
  { key: "movie", title: "Фильмы", formats: ["MOVIE"] },
  { key: "special", title: "Спешлы", formats: ["SPECIAL"] },
  { key: "ova", title: "OVA и ONA", formats: ["OVA", "ONA"] },
];
const OTHER = { key: "other", title: "Другое" };

/** Раскладывает связи по группам; порядок внутри группы сохраняется, пустые группы не возвращаются. */
export function groupRelations(relations) {
  const buckets = new Map([...GROUPS, OTHER].map((g) => [g.key, { key: g.key, title: g.title, items: [] }]));
  for (const rel of relations) {
    const group = GROUPS.find((g) => g.formats.includes(rel.format)) ?? OTHER;
    buckets.get(group.key).items.push(rel);
  }
  return [...buckets.values()].filter((g) => g.items.length);
}
