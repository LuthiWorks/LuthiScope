// Plain-language panel explanations (hover tooltips). Split from app.js 2026-09-29.


// Hover explanations for every panel, in plain language with jargon glossed in
// parentheses (Brian, 2026-07-25). Keyed "group|panel title" — keys must match
// GROUPS exactly; a missing key just means no tooltip, never an error.
export const PANEL_DESCS = {
  "Learning|LOSS": "How wrong the model's predictions are right now (loss = the error score training tries to shrink). l_pred is the prediction part, l_sigreg is the anti-collapse penalty (a guard that stops the model from outputting the same thing for everything). Falling is good.",
  "Learning|VISREG (when emitted)": "The anti-collapse regularizer that replaced SIGReg in VISReg-era runs (2026-08-11), split into its three parts: shape (do the latent directions look like healthy, varied signals?), center (is the whole representation drifting off-center? -- the classic first symptom of collapse), and scale (are dimensions at a healthy volume?). Starts ENORMOUS on an untrained model because it is loudly objecting to the newborn representation's offset -- what matters is that it falls by orders of magnitude as training bites. Falling is good.",
  "Learning|HELDOUT EVAL · NMSE is the guard's gauge": "A test on material the model never trains on (heldout = kept out of training). Since 2026-08-11 the quick few-batch checks the divergence guard runs every cadence are logged too (marked 'quick' in the record), so heldout_nmse is the SAME number that can kill a run: NMSE 1.0 = no better than predicting the mean, and the guard fires above 2.0. The epoch-end point is the higher-quality 50-batch estimate. Down is good.",
  "Language|PERPLEXITY (when emitted)": "How surprised the model is by each next token, on a human scale: 32000 = pure guessing over the whole vocabulary, ~200 = a small model reading fluently, single digits = mastery. THE deployment-readiness gauge for the speaking era -- it cannot be flattered by a collapsed representation, because predicting words well requires the space behind them to work. Down is good.",
  "Dimension|SOLOIST SHARE (when emitted)": "How much of the representation's total variation is carried by its single loudest direction (the 'soloist'). Down is good: under ~3% matches healthy training; near 100% means one direction is the whole show. This is the number the variance-budget work taxes directly.",
  "Dimension|CHORUS RANK (when emitted)": "The stable rank of everything EXCEPT the loudest direction -- the health of the supporting cast. Up is good. A rebuilding chorus under a stubborn soloist shows here while plain stable rank stays flat; watching both tells you whether a low stable rank means a dead space or one loud voice.",
  "Optimization|GRADIENT NORM (when emitted)": "The overall size of the correction signal each step (gradient = the direction and amount training wants to change each weight). Sudden spikes can mean instability; a slow settle is normal.",
  "Optimization|LEARNING RATE (when emitted)": "How big a step the optimizer takes on each update (learning rate = the step-size dial; schedules often warm it up, then decay it). A schedule readout, not a health signal.",
  "Optimization|PLASTICITY TAPER (when emitted)": "A schedule that gradually reduces how changeable the living weights are — a formative, highly plastic youth easing into a stable maturity. It is SUPPOSED to fall.",
  "Optimization|WEIGHT NORM (when emitted)": "The total size of all the model's weights added up (norm = a single number summarizing magnitude). Steady growth is normal; runaway growth can mean the model is inflating instead of learning.",
  "Optimization|UPDATE / WEIGHT RATIO (when emitted)": "How large each update is compared to the weights it changes. A classic tuning gauge: too high and training thrashes, too low and it crawls.",
  "Optimization|AMP LOSS SCALE (when emitted)": "A safety multiplier used when training in low-precision numbers (AMP = automatic mixed precision, a speed trick). It auto-adjusts; frequent collapses to tiny values mean numeric trouble.",
  "Optimization|GRAD-CLIP FRACTION (when emitted)": "How often the correction signal was so large it had to be capped (gradient clipping = a limiter that prevents any single step from being violent). Frequently high means training is straining against the limiter.",
  "Substrate vitality|SUBSTRATE PULSE": "The living substrate's heartbeat: pred_frob is how much predictive structure the self-modifying layers have built (rising = building), err_acc is their accumulated prediction error (it oscillates healthily — direction alone is not health). Both are measured against the representation, so when rank is on the floor neither is interpretable — err_acc in particular runs HIGH because l_pred is thrashing on a degenerate target, i.e. elevated by the very failure it looks like it is reporting. The panel says so when that happens.",
  "Substrate vitality|DRIFT & PLASTICITY (when emitted)": "How far the living weights have wandered from their homeostatic set point (the baseline they are gently pulled back toward), and how actively they are self-modifying right now. Learning looks like drift with activity; consolidation looks like both easing.",
  "Substrate vitality|CONSOLIDATION FIRES · cumulative (when emitted)": "A running count of consolidation events — moments where recent experience gets locked into lasting structure (memory becoming anatomy). The interesting shape is where the steps land: calm windows are consolidation season.",
  "Substrate vitality|PRECISION (when emitted)": "How confident the living layers are in their own predictions (precision = confidence weighting; higher means the substrate trusts what it expects to see). Climbs as its world-model sharpens.",
  "Substrate vitality|TRUST RATIO SPREAD (p95/p5, when emitted)": "Whether the substrate trusts some inputs more than others (relative trust, the v5 mechanism). Near 1.0 = it treats everything the same; above 1 = it has real preferences. A state readout, not a score.",
  "Substrate vitality|PER-BLOCK SUBSTRATE · by block, deep cadence (when emitted)": "The same substrate vitals, but shown for each block (block = one layer-like unit) as colored rows over time — so a single struggling block stands out even when the average looks fine. The dropdown also carries each block's collapse trio (effective_rank, top_dir_share, chorus_eff_rank: read chorus alongside rank — low rank with high chorus is a loud soloist over an intact representation, low with low is real collapse) and the contribution pair (contrib_var_ratio, contrib_chorus, since 2026-09-29): what the block ADDS, not what it outputs. A block can read healthy on every output gauge while adding nothing — the residual stream carries the richness past it. contrib_var_ratio near zero is that bypass signature; contrib_chorus blank means the block's addition is a single direction, not a rich transformation.",
  "Representation|VITALITY · ENCODER STD / PREDICTOR-TRIVIAL COSINE": "Anti-collapse vitals. std = how varied the model's internal descriptions are (all-identical outputs would be collapse); triv_cos = how close the predictor is to just copying its input (1.0 = copying, the trivial cheat). Levels matter more than direction here.",
  "Representation|DIMENSION · RANK (deep cadence — sparse)": "How many independent dimensions of description the model actually uses (effective rank = the working size of its vocabulary of ideas). A sustained drop means its representation is thinning out. Measured rarely — sparse dots. Read the ABSOLUTE values, not the percent: the percent is anchored to this run's first deep firing, which is the init state in every run and not a health reading. The dashed floor at rank 1 is one direction — degenerate at any width. A shaded band appears only if you designate reference runs (select them in the streams list, then ◫); it is recomputed from those runs' own logs, step-matched, and never stored.",
  "Throughput|TOKENS CONSUMED": "Total amount of data seen so far, in tokens (token = one small chunk of text/audio/image the model reads at a time). A straight-line odometer.",
  "Throughput|ELAPSED (hours)": "Wall-clock time since the run started. Pure bookkeeping.",
  "Throughput|STEP TIME (when emitted)": "How long each training step takes. Creeping upward can mean a leak or thermal throttling; spikes mean stalls (often disk or data loading).",
  "Throughput|RATE · SAMPLES & TOKENS /s (when emitted)": "Training speed: how many examples and tokens are processed per second. The efficiency gauge — flat and high is the goal.",
  "Language modeling|CROSS-ENTROPY (when emitted)": "The standard next-token training error for language models (cross-entropy = how surprised the model is by the correct next word). Falling is good.",
  "Language modeling|PERPLEXITY (when emitted)": "Cross-entropy re-expressed as a branching factor (perplexity = roughly, how many words the model is torn between; 1 would be certainty). Lower is better; val_ppl is the same measured on unseen data.",
  "Language modeling|TOKEN ACCURACY (when emitted)": "How often the model's top guess for the next token is exactly right (top1), or within its best five guesses (top5). Higher is better.",
  "Reasoning & RL|REWARD (when emitted)": "The average score the model earns per attempt (reward = the signal reinforcement learning maximizes). Rising means the policy is improving — or gaming the reward; corroborate with success rate.",
  "Reasoning & RL|SUCCESS / PASS RATE (when emitted)": "Fraction of tasks actually solved (pass@1 = solved on the first try). The ground-truth cousin of reward.",
  "Reasoning & RL|KL TO REFERENCE (when emitted)": "How far the model has drifted from its reference version (KL divergence = a distance between two models' behavior). Some drift is the point; runaway drift means it is forgetting what it was.",
  "Reasoning & RL|POLICY ENTROPY (when emitted)": "How much the model still explores versus always picking the same answer (entropy = randomness in its choices). Collapsing to zero early means it stopped exploring.",
  "Reasoning & RL|RESPONSE / EPISODE LENGTH (when emitted)": "How long the model's answers or episodes run. Watch for drift — reward hacking often shows up as answers ballooning or shriveling.",
  "Vision & video|RECONSTRUCTION LOSS (when emitted)": "How badly the model redraws what it was shown (reconstruction = compress the image/video, then rebuild it; the error is what was lost). Falling is good.",
  "Vision & video|PSNR / SSIM (when emitted)": "Standard picture-quality scores comparing output to the original: PSNR (signal-to-noise, in dB) and SSIM (structural similarity, 0-1). Higher is better for both.",
  "Vision & video|FID (eval cadence — sparse, when emitted)": "How distinguishable generated images are from real ones, statistically (FID = Fréchet Inception Distance; 0 would be indistinguishable). Lower is better. Computed rarely — sparse dots.",
  "Vision & video|VQ CODEBOOK USAGE (when emitted)": "How much of the model's visual vocabulary is actually in use (codebook = the fixed set of visual 'words' a VQ model can pick from). Low usage means most of the vocabulary sits dead.",
  "Audio|SI-SNR (when emitted)": "Audio clarity score: how cleanly the target sound stands out from the error (scale-invariant signal-to-noise ratio, in dB). Higher is better.",
  "Audio|MEL / STFT LOSS (when emitted)": "Spectrogram errors — how different the produced audio's frequency picture is from the target's (mel/STFT = two standard ways of turning sound into a frequency image). Falling is good.",
  "Evaluation|VALIDATION LOSS (when emitted)": "The training error measured on data the model never trains on (validation set). If training loss falls while this rises, the model is memorizing, not learning (overfitting).",
  "Evaluation|ACCURACY (when emitted)": "Fraction of answers correct, on training data (train_acc) and unseen data (val_acc). A widening gap between the two is the classic overfitting signature.",
  "Systems & resources|GPU MEMORY (when emitted)": "How much video memory the run occupies. Creeping upward across hours usually means a leak; hitting the ceiling means crashes ahead.",
  "Systems & resources|GPU UTILIZATION (when emitted)": "How busy the GPU is. Sustained dips mean the GPU is starving — usually waiting on data loading or CPU work.",
  "Systems & resources|MFU (when emitted)": "Fraction of the hardware's theoretical peak math throughput actually achieved (MFU = model FLOPs utilization). The efficiency grade: big well-tuned runs reach 40-60%.",
  "Internal state|PRECISION & VALUE (active-inference correlates)": "The mind's confidence and outlook: gamma is how decisively it commits to a plan (policy precision), v_s is how good it expects its current situation to be (value estimate).",
  "Internal state|EXPECTED FREE ENERGY · affect-adjacent (lower = better)": "The quantity the mind minimizes when choosing actions (expected free energy = predicted surprise plus predicted cost — loosely, unease). The components are the costs it weighs: engagement, coherence, connection, truthfulness. Lower is better.",
  "Dynamics|PLASTICITY PULSE · ||Δθ||": "How much the living weights moved this cycle (Δθ = the change in the weights themselves — the mind physically changing as it thinks). The cognition-side heartbeat.",
  "Dynamics|MUTUAL INFORMATION + BAND": "How much the mind's internal state actually reflects its input (mutual information = statistical coupling between world and mind), with its expected healthy band. Falling out of band means decoupling.",
  "Dynamics|BEST-ACTION VALUE · r_best": "The score of the best action the planner found this cycle. Persistently low means nothing looks appealing — including rest.",
};

// One shared floating tooltip for panel explanations. Native title= attributes
// were unreliable in the pywebview window (and unstylable anyway), so this is a
// themed div positioned under the hovered element, clamped to the viewport.
export let panelTip = null;
export function attachDesc(el, text) {
  el.addEventListener("mouseenter", () => {
    if (!panelTip) {
      panelTip = document.createElement("div");
      panelTip.id = "panel-tip";
      panelTip.style.display = "none";
      document.body.appendChild(panelTip);
    }
    panelTip.textContent = text;
    panelTip.style.display = "block";
    const r = el.getBoundingClientRect();
    const tw = panelTip.offsetWidth, th = panelTip.offsetHeight;
    let x = r.left, y = r.bottom + 8;
    if (x + tw > window.innerWidth - 8) x = window.innerWidth - tw - 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
    panelTip.style.left = Math.max(8, x) + "px";
    panelTip.style.top = Math.max(8, y) + "px";
  });
  el.addEventListener("mouseleave", () => { if (panelTip) panelTip.style.display = "none"; });
}
