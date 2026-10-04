// Fixed wording. Numbers shown next to it come from /meta, never from here.

export const DISCLAIMER =
  'RiskAtlas is a research prototype for decision support and educational purposes only. It is not a medical device, does not provide a diagnosis, and is not a substitute for formal diagnostic imaging or clinical judgement.';

export const MOCK_LABEL = 'MOCK DATA - not a real prediction';

export const CAVEATS = {
  perVessel: 'Predictions are made per vessel (and for overall CAD), each with its own model and cut points.',
  schematic: 'The 3D view is a schematic risk map: it colours whole vessels and does not locate lesions within a vessel.',
  cohort:
    'The models were trained on a small single-centre dataset of patients referred for coronary angiography, so they may not transfer to other populations.',
} as const;
