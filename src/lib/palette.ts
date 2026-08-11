// Paleta categorica validada (CVD-safe, orden fijo, no ciclar) para dark mode
// (la app usa tema oscuro fijo). Ver dataviz skill / references/palette.md.
export const PALETTE_CATEGORICA = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

export const CHART_CHROME = {
  gridline: "#262626", // --border
  axis: "#8a8a8a", // --muted
  texto: "#ededed", // --foreground
  textoSecundario: "#8a8a8a", // --muted
} as const;
