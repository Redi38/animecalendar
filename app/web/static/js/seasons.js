/** Сезоны идут по кругу: порядковый номер = год * (число сезонов) + позиция сезона в году. */

export function seasonIndex(slugs, year, slug) {
  return year * slugs.length + slugs.indexOf(slug);
}

/** Сезон на delta шагов от заданного (может быть отрицательным): { year, slug }. */
export function seasonStep(slugs, year, slug, delta) {
  const total = seasonIndex(slugs, year, slug) + delta;
  const n = slugs.length;
  return { year: Math.floor(total / n), slug: slugs[((total % n) + n) % n] };
}
