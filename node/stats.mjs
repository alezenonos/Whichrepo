// The instruments the rest of a which* repository measures with before it designs anything. Each
// one refuses the questions it cannot answer rather than returning a number for them, because a
// wrong answer from an instrument is indistinguishable from a real finding.

// `Number(null)` is 0 and `Number.isFinite(0)` is true. The first draft of Whichcar's validation put
// the 45 records with no published width into the width fit at zero and reported a correlation of
// -0.08 for a relationship that is really 0.87. Absence is not a number here either.
export const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const mae = (errors) => mean(errors.map(Math.abs));
export const round = (value, digits = 3) =>
  value === null || !Number.isFinite(value) ? null : Number(Number(value).toFixed(digits));
export const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
};

// Both means were once divided by `xs.length` while `ys` was summed in full, which meant two columns
// of unequal length -- the shape two `.map()` calls over differently filtered catalogues produce --
// returned a plausible small correlation instead of failing. Three pairs of a perfect r = 1 read
// back as 0.008 when a longer `ys` was passed alongside them, which is indistinguishable from
// "this variable is unusable" and would have retired a good predictor on the strength of a bug.
//
// The degenerate cases return null rather than NaN: fewer than two pairs and a column with no
// variance are both "the question does not apply", and NaN reads as a failed computation.
export function pearson(xs, ys) {
  if (xs.length !== ys.length)
    throw new Error(`pearson needs two columns of the same length; got ${xs.length} and ${ys.length}`);
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Fisher z over the standard error, so a correlation can be called significant or not rather
// than merely large or small. |z/SE| > 1.96 is the 95% threshold.
export function correlationSignificance(r, n) {
  return (0.5 * Math.log((1 + r) / (1 - r))) / (1 / Math.sqrt(n - 3));
}

// Mid-rank percentiles: tied values share the average of the ranks they span, so a value held by
// half the field lands mid-field rather than at an edge -- the only honest ranking for sources as
// coarse as a five-star rating.
//
// Returns 0.5 for a single-element series, because one item ranked against itself has no standing
// -- not 0, which `below / (n - 1)` would produce as a division by zero and which would read as "the
// worst item in the field".
export function midRankPercentile(values) {
  const series = values.filter((value) => Number.isFinite(value));
  return (value) => {
    if (series.length < 2) return 0.5;
    const below = series.filter((entry) => entry < value).length;
    const equal = series.filter((entry) => entry === value).length;
    return (below + (equal - 1) / 2) / (series.length - 1);
  };
}

// ---------------------------------------------------------------------------------------------
// Least squares, and the two baselines every fit is measured against
// ---------------------------------------------------------------------------------------------
// A fit that cannot beat "predict the mean" is not carrying information about the item, whatever
// its in-sample error says -- and three of the four tier regressions in Whichcar's rubric could not,
// which is the finding this section was built to make visible rather than arguable.
export function fitLine(pairs) {
  const n = pairs.length;
  const meanX = mean(pairs.map(([x]) => x));
  const meanY = mean(pairs.map(([, y]) => y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) ** 2;
    syy += (y - meanY) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: meanY - slope * meanX, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : null, n };
}

// Rows are `{ group, x, y }`. A group is held out whole: every record of one brand leaves the
// training set together, because that is how a fitted fallback meets a new item -- from a brand it
// never saw. A group whose removal would leave fewer than `minTrain` rows is skipped rather than
// trained on a stump, and the report says how many rows were scored.
export function groupedHoldout(rows, { minTrain = 5, predict = null } = {}) {
  const groups = [...new Set(rows.map((row) => row.group))];
  const errors = [];
  const meanOnlyErrors = [];
  const bySubgroup = new Map();
  for (const group of groups) {
    const train = rows.filter((row) => row.group !== group);
    const test = rows.filter((row) => row.group === group);
    if (train.length < minTrain) continue;
    const model = predict ? predict(train) : fitLine(train.map((row) => [row.x, row.y]));
    const predictor = predict ? model : (x) => model.intercept + model.slope * x;
    const trainMean = mean(train.map((row) => row.y));
    for (const row of test) {
      const error = row.y - predictor(row.x, row);
      errors.push(error);
      meanOnlyErrors.push(row.y - trainMean);
      const key = row.subgroup ?? null;
      if (key !== null) {
        if (!bySubgroup.has(key)) bySubgroup.set(key, []);
        bySubgroup.get(key).push(error);
      }
    }
  }
  const fitted = mae(errors);
  const baseline = mae(meanOnlyErrors);
  return {
    n: errors.length,
    groups: groups.length,
    mae: round(fitted),
    bias: round(mean(errors)),
    p90: round(quantile(errors.map(Math.abs), 0.9)),
    mean_only_mae: round(baseline),
    // Positive means the fit beats predicting the catalogue mean. Zero or negative means the
    // predictor is carrying no information about the item out of sample.
    skill: round(baseline ? (baseline - fitted) / baseline : null),
    errors,
    subgroups: Object.fromEntries(
      [...bySubgroup.entries()]
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([key, values]) => [
          key,
          { n: values.length, mae: round(mae(values)), bias: round(mean(values)) },
        ]),
    ),
  };
}

// `predict`, where given, is the rule that ships: it takes the training rows and returns a
// predictor. Without it these fit a straight line, which is what every tier fit is -- and which
// Whichcar's luxury fallback was measured as for a month while it shipped something else.
export function leaveOneOut(rows, { predict = null } = {}) {
  const errors = rows.map((row, index) => {
    const train = rows.filter((_, other) => other !== index);
    if (predict) return row.y - predict(train)(row.x, row);
    const model = fitLine(train.map((entry) => [entry.x, entry.y]));
    return row.y - (model.intercept + model.slope * row.x);
  });
  return { mae: round(mae(errors)), bias: round(mean(errors)) };
}

export function inSample(rows, { predict = null } = {}) {
  if (predict) {
    const predictor = predict(rows);
    const errors = rows.map((row) => row.y - predictor(row.x, row));
    return { mae: round(mae(errors)), bias: round(mean(errors)) };
  }
  const model = fitLine(rows.map((row) => [row.x, row.y]));
  const errors = rows.map((row) => row.y - (model.intercept + model.slope * row.x));
  return {
    mae: round(mae(errors)),
    bias: round(mean(errors)),
    r: round(model.r),
    slope: round(model.slope, 4),
    intercept: round(model.intercept, 4),
  };
}
