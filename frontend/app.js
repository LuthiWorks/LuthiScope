"use strict";

// identity palette for distinguishing series (bright on white)
const C = {
  blue: "#3b82f6", teal: "#22d3ee", green: "#22c55e",
  purple: "#a78bfa", orange: "#fb923c", red: "#f87171", gray: "#94a3b8",
};

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// each series declares which direction is "healthy" so momentum can be colored
// (good: "up" | "down" | null). null = no health claim (ambiguous metric).
// Grouped metric config. Panels whose series have no data are auto-hidden, so the
// "(when emitted)" panels below appear automatically once the producer starts
// emitting those fields (see the shortlist in the metrics discussion).
const GROUPS = {
  training: {
    x: (r) => num(r.step),
    xlabel: "step",
    groups: [
      { title: "Learning", panels: [
        { title: "LOSS", series: [
          { label: "loss", color: C.blue, good: "down", get: (r) => num(r.loss) },
          { label: "l_pred", color: C.teal, good: "down", get: (r) => num(r.l_pred) },
          { label: "l_sigreg", color: C.purple, good: "down", get: (r) => num(r.l_sigreg) },
        ]},
        // Heldout eval fires only at epoch boundaries, so this series is
        // a handful of points across a 72k-step run: sparse=true draws
        // visible markers and the line spans the null gaps. The LM-era
        // val_loss / probe_acc keys were removed 2026-07-21 -- no JEPA
        // log ever emits them, so the tiles read "no data" forever and
        // the (invisible) sparse heldout points made the whole panel
        // look dead (Brian's report).
        { title: "HELDOUT EVAL (epoch boundaries)", sparse: true, series: [
          { label: "heldout_l_pred", color: C.orange, good: "down", get: (r) => num(r.heldout?.text?.l_pred_mean) },
          { label: "heldout_nmse", color: C.red, good: "down", get: (r) => num(r.heldout?.text?.nmse_mean) },
        ]},
      ]},
      { title: "Optimization", panels: [
        { title: "GRADIENT NORM (when emitted)", series: [
          { label: "grad_norm", color: C.orange, good: null, get: (r) => num(r.grad_norm) },
        ]},
        { title: "LEARNING RATE (when emitted)", series: [
          { label: "lr", color: C.teal, good: null, get: (r) => num(r.lr) },
        ]},
        { title: "PLASTICITY TAPER (when emitted)", series: [
          // Schedule, not health (run-3 build, 2026-07-17): declining
          // to its floor is BY DESIGN — the formative->mature taper.
          { label: "taper_scale", color: C.purple, good: null, get: (r) => num(r.taper_scale) },
        ]},
        { title: "WEIGHT NORM (when emitted)", series: [
          { label: "weight_norm", color: C.blue, good: null, get: (r) => num(r.weight_norm ?? r.param_norm) },
        ]},
        { title: "UPDATE / WEIGHT RATIO (when emitted)", series: [
          { label: "update_ratio", color: C.green, good: null, get: (r) => num(r.update_ratio ?? r.update_to_weight_ratio) },
        ]},
        { title: "AMP LOSS SCALE (when emitted)", series: [
          { label: "loss_scale", color: C.gray, good: null, get: (r) => num(r.loss_scale ?? r.grad_scale ?? r.amp?.loss_scale) },
        ]},
        { title: "GRAD-CLIP FRACTION (when emitted)", series: [
          { label: "clip_frac", color: C.red, good: null, get: (r) => num(r.clip_fraction ?? r.clip_frac ?? r.grad_clip_frac) },
        ]},
      ]},
      { title: "Substrate vitality", panels: [
        { title: "SUBSTRATE PULSE", series: [
          { label: "pred_frob", color: C.green, good: "up", get: (r) => num(r.substrate?.pred_frob) },
          // Polarity corrected 2026-07-18 (the kill-6 false-positive
          // lesson, JEPA pilot): err_acc oscillates healthily and rises
          // with data variety — direction alone is not health. The
          // detectors judge it against a smoothed running best; a tile
          // color cannot, so it makes no claim.
          { label: "err_acc", color: C.orange, good: null, get: (r) => num(r.substrate?.err_acc) },
        ]},
        { title: "DRIFT & PLASTICITY (when emitted)", series: [
          { label: "set_point_drift", color: C.purple, good: null, get: (r) => num(r.substrate?.set_point_drift) },
          { label: "update_rate", color: C.teal, good: null, get: (r) => num(r.substrate?.update_ema_mean) },
        ]},
        { title: "CONSOLIDATION FIRES · cumulative (when emitted)", series: [
          // Memory-becoming-structure events, summed across blocks
          // (Brian's request 2026-07-18). Monotonic counter; the
          // interesting shape is WHERE the steps land — calm windows
          // are consolidation season.
          { label: "consol_fires", color: C.orange, good: null, get: (r) => num(r.substrate?.consolidation_fires) },
        ]},
        { title: "PRECISION (when emitted)", series: [
          { label: "precision", color: C.blue, good: null, get: (r) => num(r.substrate?.precision_mean) },
        ]},
        // Trust differentiation (v5 relative-trust era, 2026-07-21):
        // p95/p5 of the per-input reliability ledger, mean across
        // blocks. ~1.0 = saturated/uniform trust (every pre-v5 family);
        // >1 = the trust weighting has real differences to act on.
        // Neutral polarity: spread is a STATE readout, not a score.
        { title: "TRUST RATIO SPREAD (p95/p5, when emitted)", series: [
          { label: "precision_spread", color: C.teal, good: null, get: (r) => num(r.substrate?.precision_spread) },
        ]},
        { title: "PER-BLOCK SUBSTRATE · by block, deep cadence (when emitted)", type: "heatmap",
          has: (r) => Array.isArray(r.substrate_blocks) && r.substrate_blocks.length > 0,
          metrics: ["set_point_drift", "update_ema_mean", "precision_mean", "precision_spread", "prediction_norm", "error_acc_mean", "consolidation_fires"] },
      ]},
      { title: "Representation", panels: [
        // Polarities corrected 2026-07-18 after the JEPA pilot's detector
        // false-positives (LuthiModel pre-registration, kill-1 and kill-5
        // amendments): healthy training COMPRESSES std from init scale
        // (kill-1 fired on a run whose effective rank was RISING), and the
        // predictor cosine CLIMBING is the substrate solving its
        // prediction problem, not copying (kill-5's lesson). Direction
        // alone is not health for either — the level-vs-floor and
        // rank-corroboration judgments belong to the detectors. The
        // health-bearing tiles in this group are eff_rank / stable_rank,
        // whose polarity is real.
        { title: "VITALITY · ENCODER STD / PREDICTOR-TRIVIAL COSINE", series: [
          { label: "std_p5", color: C.green, good: null, get: (r) => num(r.light?.online_std_p5) },
          { label: "std_p50", color: C.teal, good: null, get: (r) => num(r.light?.online_std_p50) },
          { label: "std_p95", color: C.gray, good: null, get: (r) => num(r.light?.online_std_p95) },
          { label: "triv_cos", color: C.red, good: null, get: (r) => num(r.light?.predictor_trivial_cosine_mean) },
        ]},
        { title: "DIMENSION · RANK (deep cadence — sparse)", sparse: true, series: [
          { label: "eff_rank", color: C.blue, good: "up", get: (r) => num(r.deep?.effective_rank) },
          { label: "stable_rank", color: C.purple, good: "up", get: (r) => num(r.deep?.stable_rank) },
        ]},
      ]},
      { title: "Throughput", panels: [
        { title: "TOKENS CONSUMED", series: [
          { label: "tokens", color: C.green, good: "up", get: (r) => {
            const t = r.tokens_consumed; if (!t) return null;
            let s = 0; for (const k in t) { if (typeof t[k] === "number") s += t[k]; } return s;
          } },
        ]},
        { title: "ELAPSED (hours)", series: [
          { label: "elapsed_h", color: C.gray, good: null, get: (r) => num(r.elapsed_seconds) == null ? null : r.elapsed_seconds / 3600 },
        ]},
        { title: "STEP TIME (when emitted)", series: [
          { label: "step_time", color: C.orange, good: "down", get: (r) => num(r.step_time ?? r.sec_per_step ?? r.step_seconds) },
        ]},
        { title: "RATE · SAMPLES & TOKENS /s (when emitted)", series: [
          { label: "samples_s", color: C.green, good: "up", get: (r) => num(r.samples_per_sec ?? r.samples_per_second ?? r.throughput) },
          { label: "tokens_s", color: C.teal, good: "up", get: (r) => num(r.tokens_per_sec ?? r.tokens_per_second) },
        ]},
      ]},
      // ---- universal dead-weights catalog ----
      // Categories below cover what someone training a conventional
      // (backprop-only, no living substrate) model would watch — LLM/LRM,
      // JEPA variants, vision/video, audio, RL — reading the metric keys such
      // trainers conventionally emit (alias-tolerant per accessor). Panels
      // auto-hide without data, so a Luthi run shows none of this and a
      // LLaMA-style run lights up only its own rows; the settings > Metric
      // panels menu selects which are eligible at all.
      { title: "Language modeling", panels: [
        { title: "CROSS-ENTROPY (when emitted)", series: [
          { label: "ce_loss", color: C.blue, good: "down", get: (r) => num(r.ce_loss ?? r.cross_entropy ?? r.loss_ce ?? r.lm_loss) },
        ]},
        { title: "PERPLEXITY (when emitted)", series: [
          { label: "ppl", color: C.purple, good: "down", get: (r) => num(r.perplexity ?? r.ppl) },
          { label: "val_ppl", color: C.orange, good: "down", get: (r) => num(r.val_perplexity ?? r.val_ppl ?? r.val?.perplexity) },
        ]},
        { title: "TOKEN ACCURACY (when emitted)", series: [
          { label: "top1", color: C.green, good: "up", get: (r) => num(r.token_accuracy ?? r.token_acc ?? r.acc_top1 ?? r.top1) },
          { label: "top5", color: C.teal, good: "up", get: (r) => num(r.acc_top5 ?? r.top5) },
        ]},
      ]},
      { title: "Reasoning & RL", panels: [
        { title: "REWARD (when emitted)", series: [
          { label: "reward", color: C.green, good: "up", get: (r) => num(r.reward ?? r.reward_mean ?? r.mean_reward) },
        ]},
        { title: "SUCCESS / PASS RATE (when emitted)", series: [
          { label: "success", color: C.blue, good: "up", get: (r) => num(r.success_rate ?? r.pass_rate ?? r.pass_at_1 ?? r.solve_rate) },
        ]},
        { title: "KL TO REFERENCE (when emitted)", series: [
          { label: "kl", color: C.orange, good: null, get: (r) => num(r.kl ?? r.kl_ref ?? r.kl_divergence) },
        ]},
        { title: "POLICY ENTROPY (when emitted)", series: [
          { label: "entropy", color: C.purple, good: null, get: (r) => num(r.entropy ?? r.policy_entropy) },
        ]},
        { title: "RESPONSE / EPISODE LENGTH (when emitted)", series: [
          { label: "length", color: C.gray, good: null, get: (r) => num(r.response_length ?? r.gen_length ?? r.episode_length) },
        ]},
      ]},
      { title: "Vision & video", panels: [
        { title: "RECONSTRUCTION LOSS (when emitted)", series: [
          { label: "recon", color: C.blue, good: "down", get: (r) => num(r.recon_loss ?? r.l_recon ?? r.reconstruction_loss) },
        ]},
        { title: "PSNR / SSIM (when emitted)", series: [
          { label: "psnr", color: C.green, good: "up", get: (r) => num(r.psnr) },
          { label: "ssim", color: C.teal, good: "up", get: (r) => num(r.ssim) },
        ]},
        { title: "FID (eval cadence — sparse, when emitted)", sparse: true, series: [
          { label: "fid", color: C.red, good: "down", get: (r) => num(r.fid) },
        ]},
        { title: "VQ CODEBOOK USAGE (when emitted)", series: [
          { label: "codebook", color: C.purple, good: "up", get: (r) => num(r.codebook_usage ?? r.vq_perplexity ?? r.codebook_perplexity) },
        ]},
      ]},
      { title: "Audio", panels: [
        { title: "SI-SNR (when emitted)", series: [
          { label: "si_snr", color: C.green, good: "up", get: (r) => num(r.si_snr ?? r.sisnr) },
        ]},
        { title: "MEL / STFT LOSS (when emitted)", series: [
          { label: "mel", color: C.blue, good: "down", get: (r) => num(r.mel_loss) },
          { label: "stft", color: C.teal, good: "down", get: (r) => num(r.stft_loss) },
        ]},
      ]},
      { title: "Evaluation", panels: [
        { title: "VALIDATION LOSS (when emitted)", series: [
          { label: "val_loss", color: C.orange, good: "down", get: (r) => num(r.val_loss ?? r.valid_loss ?? r.val?.loss ?? r.eval?.loss) },
        ]},
        { title: "ACCURACY (when emitted)", series: [
          { label: "train_acc", color: C.teal, good: "up", get: (r) => num(r.train_accuracy ?? r.train_acc ?? r.accuracy) },
          { label: "val_acc", color: C.green, good: "up", get: (r) => num(r.val_accuracy ?? r.val_acc ?? r.eval?.accuracy) },
        ]},
      ]},
      { title: "Systems & resources", panels: [
        { title: "GPU MEMORY (when emitted)", series: [
          { label: "gpu_mem", color: C.blue, good: null, get: (r) => num(r.gpu_mem_gb ?? r.gpu_memory_gb ?? r.mem_allocated_gb ?? r.gpu_mem) },
        ]},
        { title: "GPU UTILIZATION (when emitted)", series: [
          { label: "gpu_util", color: C.green, good: null, get: (r) => num(r.gpu_util ?? r.gpu_utilization) },
        ]},
        { title: "MFU (when emitted)", series: [
          { label: "mfu", color: C.purple, good: "up", get: (r) => num(r.mfu ?? r.model_flops_util) },
        ]},
      ]},
    ],
  },
  cognition: {
    x: (r) => num(r.cycle),
    xlabel: "cycle",
    groups: [
      { title: "Internal state", panels: [
        { title: "PRECISION & VALUE (active-inference correlates)", series: [
          { label: "v_s", color: C.green, good: "up", get: (r) => num(r.v_s) },
          { label: "gamma", color: C.purple, good: null, get: (r) => num(r.gamma) },
        ]},
        { title: "EXPECTED FREE ENERGY · affect-adjacent (lower = better)", series: [
          { label: "total", color: C.blue, good: "down", get: (r) => num(r.efe_breakdown?.total) },
          { label: "engagement", color: C.teal, good: "down", get: (r) => num(r.efe_breakdown?.engagement_cost) },
          { label: "coherence", color: C.purple, good: "down", get: (r) => num(r.efe_breakdown?.coherence_cost) },
          { label: "connection", color: C.orange, good: "down", get: (r) => num(r.efe_breakdown?.connection_cost) },
          { label: "truthfulness", color: C.green, good: "down", get: (r) => num(r.efe_breakdown?.truthfulness_cost) },
        ]},
      ]},
      { title: "Dynamics", panels: [
        { title: "PLASTICITY PULSE · ||Δθ||", series: [
          { label: "delta_theta", color: C.teal, good: null, get: (r) => num(r.delta_theta_norm) },
        ]},
        { title: "MUTUAL INFORMATION + BAND", series: [
          { label: "mi", color: C.green, good: "up", get: (r) => num(r.mi_probe?.mi_latest) },
          { label: "band_lo", color: C.gray, good: null, get: (r) => num(r.mi_probe?.mi_band_lower) },
          { label: "band_hi", color: C.gray, good: null, get: (r) => num(r.mi_probe?.mi_band_upper) },
        ]},
        { title: "BEST-ACTION VALUE · r_best", series: [
          { label: "r_best", color: C.blue, good: "up", get: (r) => num(r.r_best) },
        ]},
      ]},
    ],
  },
};

// Hover explanations for every panel, in plain language with jargon glossed in
// parentheses (Brian, 2026-07-25). Keyed "group|panel title" — keys must match
// GROUPS exactly; a missing key just means no tooltip, never an error.
const PANEL_DESCS = {
  "Learning|LOSS": "How wrong the model's predictions are right now (loss = the error score training tries to shrink). l_pred is the prediction part, l_sigreg is the anti-collapse penalty (a guard that stops the model from outputting the same thing for everything). Falling is good.",
  "Learning|HELDOUT EVAL (epoch boundaries)": "A test on material the model never trains on (heldout = kept out of training), run once per epoch (one full pass through the data). The honest measure of learning, as opposed to memorizing. Sparse dots, not a continuous line.",
  "Optimization|GRADIENT NORM (when emitted)": "The overall size of the correction signal each step (gradient = the direction and amount training wants to change each weight). Sudden spikes can mean instability; a slow settle is normal.",
  "Optimization|LEARNING RATE (when emitted)": "How big a step the optimizer takes on each update (learning rate = the step-size dial; schedules often warm it up, then decay it). A schedule readout, not a health signal.",
  "Optimization|PLASTICITY TAPER (when emitted)": "A schedule that gradually reduces how changeable the living weights are — a formative, highly plastic youth easing into a stable maturity. It is SUPPOSED to fall.",
  "Optimization|WEIGHT NORM (when emitted)": "The total size of all the model's weights added up (norm = a single number summarizing magnitude). Steady growth is normal; runaway growth can mean the model is inflating instead of learning.",
  "Optimization|UPDATE / WEIGHT RATIO (when emitted)": "How large each update is compared to the weights it changes. A classic tuning gauge: too high and training thrashes, too low and it crawls.",
  "Optimization|AMP LOSS SCALE (when emitted)": "A safety multiplier used when training in low-precision numbers (AMP = automatic mixed precision, a speed trick). It auto-adjusts; frequent collapses to tiny values mean numeric trouble.",
  "Optimization|GRAD-CLIP FRACTION (when emitted)": "How often the correction signal was so large it had to be capped (gradient clipping = a limiter that prevents any single step from being violent). Frequently high means training is straining against the limiter.",
  "Substrate vitality|SUBSTRATE PULSE": "The living substrate's heartbeat: pred_frob is how much predictive structure the self-modifying layers have built (rising = building), err_acc is their accumulated prediction error (it oscillates healthily — direction alone is not health).",
  "Substrate vitality|DRIFT & PLASTICITY (when emitted)": "How far the living weights have wandered from their homeostatic set point (the baseline they are gently pulled back toward), and how actively they are self-modifying right now. Learning looks like drift with activity; consolidation looks like both easing.",
  "Substrate vitality|CONSOLIDATION FIRES · cumulative (when emitted)": "A running count of consolidation events — moments where recent experience gets locked into lasting structure (memory becoming anatomy). The interesting shape is where the steps land: calm windows are consolidation season.",
  "Substrate vitality|PRECISION (when emitted)": "How confident the living layers are in their own predictions (precision = confidence weighting; higher means the substrate trusts what it expects to see). Climbs as its world-model sharpens.",
  "Substrate vitality|TRUST RATIO SPREAD (p95/p5, when emitted)": "Whether the substrate trusts some inputs more than others (relative trust, the v5 mechanism). Near 1.0 = it treats everything the same; above 1 = it has real preferences. A state readout, not a score.",
  "Substrate vitality|PER-BLOCK SUBSTRATE · by block, deep cadence (when emitted)": "The same substrate vitals, but shown for each block (block = one layer-like unit) as colored rows over time — so a single struggling block stands out even when the average looks fine.",
  "Representation|VITALITY · ENCODER STD / PREDICTOR-TRIVIAL COSINE": "Anti-collapse vitals. std = how varied the model's internal descriptions are (all-identical outputs would be collapse); triv_cos = how close the predictor is to just copying its input (1.0 = copying, the trivial cheat). Levels matter more than direction here.",
  "Representation|DIMENSION · RANK (deep cadence — sparse)": "How many independent dimensions of description the model actually uses (effective rank = the working size of its vocabulary of ideas). A sustained drop means its representation is thinning out. Measured rarely — sparse dots.",
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
let panelTip = null;
function attachDesc(el, text) {
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

function f2(v){ return v==null?"--":Number(v).toFixed(2); }
function f3(v){ return v==null?"--":Number(v).toFixed(3); }
function f4(v){ return v==null?"--":Number(v).toFixed(4); }

function g(v){
  if (v==null || !isFinite(v)) return "--";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(+v.toPrecision(4));
}
function gint(v){ return v==null?"--":(Number.isInteger(v)?String(v):String(+v.toPrecision(6))); }

function seriesStats(ys){
  const v = ys.filter((y) => y != null && isFinite(y));
  if (!v.length) return null;
  let min = v[0], max = v[0], sum = 0;
  for (const y of v) { if (y < min) min = y; if (y > max) max = y; sum += y; }
  const mean = sum / v.length;
  let varr = 0; for (const y of v) varr += (y - mean) ** 2;
  const start = v[0], end = v[v.length - 1];
  // A delta needs two samples: with one point start===end and the badge
  // would claim "+0.0%" about a trend that doesn't exist yet (the seed45
  // single-heldout-record confusion, 2026-07-19).
  const dpct = v.length >= 2 && start !== 0 ? ((end - start) / Math.abs(start)) * 100 : null;
  return { start, end, min, max, range: max - min, std: Math.sqrt(varr / v.length), dpct, n: v.length };
}

// polarity-aware health/momentum: blue(opt) green(good) yellow(warn) orange(near) red(bad)
function momentumClass(st, good){
  if (!st || st.dpct == null || good == null) return "neutral";
  const improving = good === "up" ? st.end > st.start : st.end < st.start;
  const m = Math.abs(st.dpct);
  if (improving) return m >= 10 ? "opt" : "good";
  if (m < 5) return "warn";
  if (m < 15) return "near";
  return "bad";
}

// ---- app state ----
let records = [];
let charts = [];
let current = null;
let ws = null;
let groupSeries = {};   // group title -> flat list of its visible series
let maximized = null;   // { panel, rec } of the currently enlarged panel

const $ = (id) => document.getElementById(id);

function setConn(state, text) {
  const el = $("conn");
  el.className = "conn " + state;
  el.textContent = "● " + text;
}

function axisStyle() {
  return {
    stroke: "#8492a8",
    grid: { stroke: "rgba(255,255,255,0.06)", width: 1 },
    ticks: { stroke: "rgba(255,255,255,0.10)", width: 1 },
    font: "11px monospace",
  };
}

function tooltipPlugin(xlabel) {
  let tip;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "u-tip";
        tip.style.display = "none";
        u.over.appendChild(tip);
        u.over.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      },
      setCursor: (u) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || left < 0 || top == null) { tip.style.display = "none"; return; }
        // show only the series whose point is nearest the cursor (vertically) at this x
        let best = -1, bestDist = Infinity;
        for (let si = 1; si < u.series.length; si++) {
          const v = u.data[si][idx];
          if (v == null) continue;
          const py = u.valToPos(v, u.series[si].scale || "y");
          const d = Math.abs(py - top);
          if (d < bestDist) { bestDist = d; best = si; }
        }
        if (best < 0) { tip.style.display = "none"; return; }
        const s = u.series[best], v = u.data[best][idx], xv = u.data[0][idx];
        tip.innerHTML =
          `<div class="u-tip-x">${xlabel} ${gint(xv)}</div>` +
          `<div class="u-tip-row"><span class="u-tip-dot" style="background:${s.stroke}"></span>` +
          `${s.label}: <b>${g(v)}</b></div>`;
        tip.style.display = "block";
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let lx = left + 14, ty = top + 14;
        if (lx + tw > u.over.clientWidth) lx = left - tw - 14;
        if (ty + th > u.over.clientHeight) ty = top - th - 14;
        tip.style.left = Math.max(0, lx) + "px";
        tip.style.top = Math.max(0, ty) + "px";
      },
    },
  };
}

// mouse-wheel zoom on the x (time) axis, centered on the cursor; double-click resets
function wheelZoomPlugin(factor = 0.85) {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        over.addEventListener("wheel", (e) => {
          if (!e.deltaY) return;
          e.preventDefault();
          const xData = u.data[0];
          if (!xData || xData.length < 2) return;
          const dataMin = xData[0], dataMax = xData[xData.length - 1];
          const left = e.clientX - over.getBoundingClientRect().left;
          const xVal = u.posToVal(left, "x");
          const oRange = u.scales.x.max - u.scales.x.min;
          const nRange = e.deltaY < 0 ? oRange * factor : oRange / factor;  // up = zoom in
          if (nRange >= dataMax - dataMin) { u.setScale("x", { min: dataMin, max: dataMax }); return; }
          const leftPct = left / over.clientWidth;
          let nMin = xVal - leftPct * nRange, nMax = nMin + nRange;
          if (nMin < dataMin) { nMax += dataMin - nMin; nMin = dataMin; }
          if (nMax > dataMax) { nMin -= nMax - dataMax; nMax = dataMax; }
          u.setScale("x", { min: nMin, max: nMax });
        }, { passive: false });
        over.addEventListener("dblclick", () => {
          const xData = u.data[0];
          if (xData && xData.length) u.setScale("x", { min: xData[0], max: xData[xData.length - 1] });
        });
      },
    },
  };
}

// true when the x window is narrower than the data (i.e., the user zoomed in)
function xIsZoomed(u) {
  const xData = u.data[0];
  if (!xData || xData.length < 2) return false;
  const full = xData[xData.length - 1] - xData[0];
  return full > 0 && (u.scales.x.max - u.scales.x.min) < full * 0.999;
}

// drag-to-pan once zoomed: plain drag slides the visible x-window (clamped to
// the data). Only active when zoomed — at full view there is nothing to pan, so
// plain drag keeps uPlot's built-in select-zoom. Shift+drag select-zooms even
// while zoomed (the escape hatch back to box-zoom). uPlot's own mousedown is
// suppressed for pan drags via cursor.bind in makeChart, not here — two
// listeners on the same element can't reliably pre-empt each other.
function dragPanPlugin() {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        let dragging = false;
        over.addEventListener("mousemove", (e) => {
          if (!dragging) over.style.cursor = xIsZoomed(u) && !e.shiftKey ? "grab" : "";
        });
        over.addEventListener("mousedown", (e) => {
          if (e.button !== 0 || e.shiftKey || !xIsZoomed(u)) return;
          e.preventDefault();
          dragging = true;
          over.style.cursor = "grabbing";
          const xData = u.data[0];
          const dataMin = xData[0], dataMax = xData[xData.length - 1];
          const startX = e.clientX, startY = e.clientY;
          const startMin = u.scales.x.min, range = u.scales.x.max - u.scales.x.min;
          const pxToVal = range / over.clientWidth;
          // Free-floating pan (Brian, 2026-07-26): the ZOOM is frozen — the
          // window's x-span and y-span stay fixed — but the window itself
          // moves wherever the drag takes it, both axes. Without the explicit
          // y set, uPlot re-fits y to visible data on every x change and the
          // viewport rescales itself to local variance mid-drag.
          const yMax0 = u.scales.y.max, ySpan = u.scales.y.max - u.scales.y.min;
          const pxToValY = ySpan / over.clientHeight;
          const move = (ev) => {
            let nMin = startMin - (ev.clientX - startX) * pxToVal;
            if (nMin < dataMin) nMin = dataMin;
            if (nMin + range > dataMax) nMin = dataMax - range;
            const nYMax = yMax0 + (ev.clientY - startY) * pxToValY;
            u.batch(() => {
              u.setScale("x", { min: nMin, max: nMin + range });
              u.setScale("y", { min: nYMax - ySpan, max: nYMax });
            });
          };
          const up = () => {
            dragging = false;
            over.style.cursor = xIsZoomed(u) ? "grab" : "";
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        });
      },
    },
  };
}

function makeChart(mountEl, spec, xlabel, widthPx) {
  const series = [{}].concat(
    spec.series.map((s) => ({
      label: s.label,
      stroke: s.color,
      width: 1.8,
      // spanGaps: sparse series are mostly nulls (epoch-boundary
      // records); without it uPlot breaks the line at every gap and
      // nothing visible gets drawn between the handful of points.
      spanGaps: !!spec.sparse,
      points: { show: !!spec.sparse, size: 6, stroke: s.color, fill: s.color },
    }))
  );
  const opts = {
    width: widthPx,
    height: 200,
    scales: { x: { time: false } },
    axes: [Object.assign(axisStyle(), { label: xlabel }), axisStyle()],
    series,
    legend: { show: false },
    cursor: {
      points: { size: 7 },
      // hand plain-drag-while-zoomed to dragPanPlugin; everything else
      // (full-view drag, shift+drag) keeps uPlot's built-in select-zoom
      bind: {
        mousedown: (u, targ, handler) => (e) => {
          if (e.button === 0 && !e.shiftKey && xIsZoomed(u)) return null;
          return handler(e);
        },
      },
    },
    plugins: [tooltipPlugin(xlabel), wheelZoomPlugin(), dragPanPlugin()],
  };
  return new uPlot(opts, [[]].concat(spec.series.map(() => [])), mountEl);
}

// sequential colormap (low -> high): deep-blue, blue, green, yellow, red
function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[15, 23, 42], [37, 99, 235], [34, 197, 94], [234, 179, 8], [239, 68, 68]];
  const seg = t * (stops.length - 1), i = Math.floor(seg), f = seg - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// blocks x time raster of a per-block substrate metric (substrate_blocks, deep cadence)
function makeHeatmap(mountEl, spec, xlabel) {
  const sel = document.createElement("select");
  sel.className = "hm-select";
  spec.metrics.forEach((m, i) => {
    const o = document.createElement("option"); o.value = m; o.textContent = m;
    if (i === 0) o.selected = true; sel.appendChild(o);
  });
  // per-block normalization: each row scaled to its own min→max, so a block
  // whose absolute range is dwarfed by a neighbor's still shows its shape
  // (the seed42 precision fan-out made block 0 look flat next to block 2)
  const NORM_KEY = "luthiscope.hmRowNorm";
  let rowNorm = false;
  try { rowNorm = localStorage.getItem(NORM_KEY) === "1"; } catch (e) {}
  const normWrap = document.createElement("label"); normWrap.className = "hm-norm";
  const normBox = document.createElement("input"); normBox.type = "checkbox"; normBox.className = "s-check";
  normBox.checked = rowNorm;
  normWrap.appendChild(normBox); normWrap.appendChild(document.createTextNode("normalize per block"));
  const canvas = document.createElement("canvas"); canvas.className = "hm-canvas";
  const foot = document.createElement("div"); foot.className = "hm-foot";
  const legend = document.createElement("span"); legend.className = "hm-legend";
  foot.appendChild(legend);
  const tip = document.createElement("div"); tip.className = "u-tip"; tip.style.display = "none";
  mountEl.appendChild(sel); mountEl.appendChild(normWrap); mountEl.appendChild(canvas); mountEl.appendChild(foot); mountEl.appendChild(tip);
  mountEl.style.position = "relative";
  const ctx = canvas.getContext("2d");
  const LABEL_W = 26;   // left gutter for block-index labels
  let recs = [], metric = spec.metrics[0], frames = [], nBlocks = 0, vmin = 0, vmax = 1;
  let rowLo = [], rowHi = [];

  function compute() {
    frames = recs.filter(spec.has);
    nBlocks = frames.reduce((m, f) => Math.max(m, f.substrate_blocks.length), 0);
    let lo = Infinity, hi = -Infinity;
    rowLo = new Array(nBlocks).fill(Infinity); rowHi = new Array(nBlocks).fill(-Infinity);
    for (const f of frames) for (let bi = 0; bi < f.substrate_blocks.length; bi++) {
      const b = f.substrate_blocks[bi];
      const v = num(b && b[metric]); if (v == null) continue;
      if (v < lo) lo = v; if (v > hi) hi = v;
      if (v < rowLo[bi]) rowLo[bi] = v; if (v > rowHi[bi]) rowHi[bi] = v;
    }
    vmin = lo === Infinity ? 0 : lo; vmax = hi === -Infinity ? 1 : hi;
  }
  function draw() {
    const w = Math.max(120, mountEl.clientWidth - 4);
    const rowH = nBlocks ? Math.max(8, Math.min(20, Math.floor(220 / nBlocks))) : 12;
    canvas.width = w; canvas.height = Math.max(40, nBlocks * rowH);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!frames.length || !nBlocks) {
      ctx.fillStyle = "#5d6a80"; ctx.font = "11px monospace";
      ctx.fillText("no per-block data yet (emitted at deep cadence)", 6, 16);
      legend.textContent = ""; return;
    }
    const plotW = w - LABEL_W, cw = plotW / frames.length, span = (vmax - vmin) || 1;
    for (let fi = 0; fi < frames.length; fi++) {
      const blocks = frames[fi].substrate_blocks;
      for (let bi = 0; bi < nBlocks; bi++) {
        const v = num(blocks[bi] && blocks[bi][metric]); if (v == null) continue;
        const t = rowNorm
          ? (v - rowLo[bi]) / ((rowHi[bi] - rowLo[bi]) || 1)
          : (v - vmin) / span;
        const c = heatColor(t);
        ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        ctx.fillRect(LABEL_W + fi * cw, bi * rowH, Math.ceil(cw), rowH);
      }
    }
    // block-index labels down the left gutter (0-based, matching the model)
    ctx.fillStyle = "#8492a8"; ctx.font = "9px monospace"; ctx.textBaseline = "middle";
    const lblStep = rowH >= 12 ? 1 : Math.ceil(nBlocks / 16);
    for (let bi = 0; bi < nBlocks; bi += lblStep) {
      ctx.fillText(String(bi), 3, bi * rowH + rowH / 2 + 0.5);
    }
    legend.textContent = rowNorm
      ? `${metric}: each block scaled to its own min…max · ${nBlocks} blocks × ${frames.length} firings`
      : `${metric}: ${g(vmin)} … ${g(vmax)} · ${nBlocks} blocks × ${frames.length} firings`;
  }
  canvas.addEventListener("mousemove", (e) => {
    if (!frames.length || !nBlocks) { tip.style.display = "none"; return; }
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) - LABEL_W;
    if (px < 0) { tip.style.display = "none"; return; }
    const fi = Math.min(frames.length - 1, Math.max(0, Math.floor(px / ((r.width - LABEL_W) / frames.length))));
    const bi = Math.min(nBlocks - 1, Math.max(0, Math.floor((e.clientY - r.top) / (r.height / nBlocks))));
    const f = frames[fi], v = num(f.substrate_blocks[bi] && f.substrate_blocks[bi][metric]);
    const c = v == null ? null : heatColor((v - vmin) / ((vmax - vmin) || 1));
    const sw = c ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : "#5d6a80";
    tip.innerHTML =
      `<div class="u-tip-x">${xlabel} ${gint(f.step != null ? f.step : f.cycle)}</div>` +
      `<div class="u-tip-row"><span class="u-tip-dot" style="background:${sw}"></span>` +
      `block ${bi} · ${metric}: <b>${v == null ? "--" : g(v)}</b></div>`;
    tip.style.display = "block";
    const mr = mountEl.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = e.clientX - mr.left + 14, ty = e.clientY - mr.top + 14;
    if (lx + tw > mountEl.clientWidth) lx = e.clientX - mr.left - tw - 14;
    if (ty + th > mountEl.clientHeight) ty = e.clientY - mr.top - th - 14;
    tip.style.left = Math.max(0, lx) + "px"; tip.style.top = Math.max(0, ty) + "px";
  });
  canvas.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  sel.addEventListener("change", () => { metric = sel.value; compute(); draw(); });
  normBox.addEventListener("change", () => {
    rowNorm = normBox.checked;
    try { localStorage.setItem(NORM_KEY, rowNorm ? "1" : "0"); } catch (e) {}
    draw();
  });

  return {
    hm: true,
    setData(records) { recs = records; compute(); draw(); },
    resize() { draw(); },
    destroy() { mountEl.innerHTML = ""; },
  };
}

// ---- metric selection (settings > Metric panels) ----
// Everything in GROUPS is enabled by default; only the DISABLED ids persist, so
// catalog additions appear without anyone touching settings. Heatmap panels
// toggle whole ("*"); series panels toggle per metric label.
// "Show panels without data": normally a panel renders only when the stream
// actually carries its metric (auto-hide), so most of the universal catalog is
// invisible on any given run. This toggle renders every ENABLED panel as a
// labeled no-data shell instead — the way to see the whole catalog laid out.
const SHOW_EMPTY_KEY = "luthiscope.showEmptyPanels";
let showEmptyPanels = false;
try { showEmptyPanels = localStorage.getItem(SHOW_EMPTY_KEY) === "1"; } catch (e) {}
const METRICS_KEY = "luthiscope.disabledMetrics";
function loadDisabledMetrics() { try { return new Set(JSON.parse(localStorage.getItem(METRICS_KEY) || "[]")); } catch (e) { return new Set(); } }
function saveDisabledMetrics() { try { localStorage.setItem(METRICS_KEY, JSON.stringify([...disabledMetrics])); } catch (e) {} }
let disabledMetrics = loadDisabledMetrics();
const metricId = (kind, group, panel, label) => `${kind}|${group}|${panel}|${label}`;
const metricEnabled = (id) => !disabledMetrics.has(id);

// Reduce a panel spec to its enabled series (shallow copy so the declarative
// catalog stays untouched); null when the whole panel is deselected.
function filterPanelByPrefs(kind, group, spec) {
  if (spec.type === "heatmap") return metricEnabled(metricId(kind, group, spec.title, "*")) ? spec : null;
  const series = spec.series.filter((s) => metricEnabled(metricId(kind, group, spec.title, s.label)));
  return series.length ? Object.assign({}, spec, { series }) : null;
}

function panelHasData(spec) {
  if (spec.type === "heatmap") return records.some(spec.has);
  return spec.series.some((s) => records.some((r) => s.get(r) != null));
}

function buildPanels(kind) {
  if (maximized) { maximized.panel.remove(); if (maximized.placeholder) maximized.placeholder.remove(); const b = $("panel-backdrop"); if (b) b.classList.remove("show"); maximized = null; }
  const cfg = GROUPS[kind];
  const host = $("panels");
  host.innerHTML = "";
  charts.forEach((c) => (c.hm ? c.hm.destroy() : c.u.destroy()));
  charts = [];
  groupSeries = {};
  const width = panelWidth();
  const visibleTitles = [];
  for (const grp of cfg.groups) {
    const panels = grp.panels
      .map((p) => filterPanelByPrefs(kind, grp.title, p))
      .filter((p) => p && (showEmptyPanels || panelHasData(p)));
    if (!panels.length) continue;            // hide empty/deselected groups
    visibleTitles.push(grp.title);
    groupSeries[grp.title] = panels.flatMap((p) => p.series || []);

    const section = document.createElement("section");
    section.className = "group";
    section.dataset.group = grp.title;
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span class="group-dot neutral" data-dot="${grp.title}"></span>` +
      `<span class="group-title">${grp.title}</span><span class="group-chev">▾</span>`;
    head.onclick = () => { section.classList.toggle("collapsed"); requestAnimationFrame(fitCharts); };
    section.appendChild(head);

    const body = document.createElement("div");
    body.className = "group-body panels-grid";
    for (const spec of panels) {
      const panel = document.createElement("div"); panel.className = "panel";
      const title = document.createElement("div"); title.className = "panel-title";
      const desc = PANEL_DESCS[`${grp.title}|${spec.title}`];
      if (desc) attachDesc(title, desc);
      const titleText = document.createElement("span"); titleText.textContent = spec.title;
      const expandBtn = document.createElement("button");
      expandBtn.className = "panel-expand"; expandBtn.title = "Enlarge"; expandBtn.textContent = "⤢";
      title.appendChild(titleText); title.appendChild(expandBtn);
      panel.appendChild(title);
      const chartHost = document.createElement("div"); panel.appendChild(chartHost);
      body.appendChild(panel);
      let rec;
      if (spec.type === "heatmap") {
        const hm = makeHeatmap(chartHost, spec, cfg.xlabel);
        rec = { hm, spec, group: grp.title, el: chartHost };
      } else {
        const readoutEl = document.createElement("div"); readoutEl.className = "panel-readout"; panel.appendChild(readoutEl);
        const u = makeChart(chartHost, spec, cfg.xlabel, width);
        rec = { u, spec, readoutEl, group: grp.title, el: chartHost };
      }
      charts.push(rec);
      expandBtn.onclick = () => toggleMaximize(panel, rec);
    }
    section.appendChild(body);
    host.appendChild(section);
  }
  buildVitals(visibleTitles);
  requestAnimationFrame(fitCharts);
}

// Size each chart to its actual container width (the grid lays out after build, so
// a fixed estimate left panels half-filled). uPlot charts get setSize; heatmaps
// self-measure on resize().
function fitCharts() {
  for (const c of charts) {
    if (c.hm) { c.hm.resize(); continue; }
    const w = (c.el && c.el.clientWidth) || panelWidth();
    if (w > 0) c.u.setSize({ width: w, height: 200 });
  }
}

// ---- enlarge a panel to the foreground (translucent overlay, not draggable) ----
function ensureBackdrop() {
  let b = $("panel-backdrop");
  if (!b) { b = document.createElement("div"); b.id = "panel-backdrop"; b.onclick = restoreMaximized; document.body.appendChild(b); }
  return b;
}
function sizeMaximized(rec) {
  if (rec.hm) { rec.hm.resize(); return; }
  const w = (rec.el && rec.el.clientWidth) || 600;
  const h = Math.max(240, Math.round(window.innerHeight * 0.82) - 120);
  rec.u.setSize({ width: w, height: h });
}
function toggleMaximize(panel, rec) {
  if (maximized && maximized.panel === panel) { restoreMaximized(); return; }
  if (maximized) restoreMaximized();
  // Leave a same-height placeholder so the grid doesn't reflow, then move the panel
  // into the root stacking context (above the backdrop, so it gets mouse/wheel events).
  const ph = document.createElement("div");
  ph.className = "panel-placeholder";
  ph.style.height = panel.getBoundingClientRect().height + "px";
  panel.parentNode.insertBefore(ph, panel);
  ensureBackdrop().classList.add("show");
  document.body.appendChild(panel);
  panel.classList.add("maximized");
  const btn = panel.querySelector(".panel-expand"); if (btn) { btn.textContent = "⤡"; btn.title = "Reduce"; }
  maximized = { panel, rec, placeholder: ph };
  requestAnimationFrame(() => sizeMaximized(rec));
}
function restoreMaximized() {
  if (!maximized) return;
  const { panel, placeholder } = maximized;
  panel.classList.remove("maximized");
  const btn = panel.querySelector(".panel-expand"); if (btn) { btn.textContent = "⤢"; btn.title = "Enlarge"; }
  const b = $("panel-backdrop"); if (b) b.classList.remove("show");
  if (placeholder && placeholder.parentNode) {   // drop the panel back into its exact slot
    placeholder.parentNode.insertBefore(panel, placeholder);
    placeholder.remove();
  }
  maximized = null;
  requestAnimationFrame(fitCharts);
}

function buildVitals(groupTitles) {
  const strip = $("statstrip");
  strip.innerHTML = "";
  for (const title of groupTitles) {
    const tile = document.createElement("div");
    tile.className = "vtile";
    tile.innerHTML = `<div class="k">${title}</div><div class="v neutral" data-vval="${title}">--</div>`;
    tile.onclick = () => {
      const sec = document.querySelector(`section.group[data-group="${title}"]`);
      if (sec) { sec.classList.remove("collapsed"); sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
    };
    strip.appendChild(tile);
  }
}

function panelWidth() {
  const host = $("panels");
  const w = host.clientWidth;
  const cols = Math.max(1, Math.floor(w / 480));
  return Math.floor(w / cols) - 26;
}

function refreshData() {
  const cfg = GROUPS[current.kind];
  const pts = records.filter((r) => cfg.x(r) != null);
  const xs = pts.map(cfg.x);
  for (const c of charts) {
    if (c.hm) { c.hm.setData(records); continue; }
    const seriesData = c.spec.series.map((s) => pts.map(s.get));
    c.u.setData([xs].concat(seriesData));
    renderReadout(c.readoutEl, c.spec, seriesData);
  }
  updateOverview();
}

function renderReadout(el, spec, seriesData) {
  let html = "";
  spec.series.forEach((s, i) => {
    const st = seriesStats(seriesData[i]);
    if (!st) {
      html += `<div class="ro-row"><span class="ro-dot" style="background:${s.color}"></span>` +
              `<span class="ro-label">${s.label}</span><span class="ro-prog">no data</span>` +
              `<span></span><span></span></div>`;
      return;
    }
    const arrow = st.end > st.start ? "▲" : (st.end < st.start ? "▼" : "–");
    const cls = momentumClass(st, s.good);
    const dtxt = st.dpct == null ? arrow
      : `${arrow} ${st.dpct >= 0 ? "+" : ""}${st.dpct.toFixed(1)}%`;
    html +=
      `<div class="ro-row">` +
        `<span class="ro-dot" style="background:${s.color}"></span>` +
        `<span class="ro-label">${s.label}</span>` +
        `<span class="ro-prog"><b>${g(st.start)}</b> → <b>${g(st.end)}</b></span>` +
        `<span class="ro-delta ${cls}">${dtxt}</span>` +
        `<span class="ro-spread">min ${g(st.min)} · max ${g(st.max)} · σ ${g(st.std)} · rng ${g(st.range)}</span>` +
      `</div>`;
  });
  el.innerHTML = html;
}

const HEALTH_ORDER = { neutral: 0, opt: 1, good: 1, warn: 2, near: 3, bad: 4 };

// recompute the per-group health tiles, group dots, and "needs attention" bar
function updateOverview() {
  const flagged = [];
  for (const title in groupSeries) {
    let worst = "neutral", worstRank = 0, headline = null, headlineSet = false;
    for (const s of groupSeries[title]) {
      const st = seriesStats(records.map(s.get));
      if (!headlineSet && st) { headline = st.end; headlineSet = true; }
      const cls = momentumClass(st, s.good);
      if (HEALTH_ORDER[cls] > worstRank) { worstRank = HEALTH_ORDER[cls]; worst = cls; }
      if (cls === "warn" || cls === "near" || cls === "bad") flagged.push({ group: title, label: s.label, cls, st });
    }
    const dot = document.querySelector(`[data-dot="${title}"]`);
    if (dot) dot.className = "group-dot " + worst;
    const vval = document.querySelector(`[data-vval="${title}"]`);
    if (vval) { vval.textContent = headlineSet ? g(headline) : "--"; vval.className = "v " + worst; }
  }
  renderAttention(flagged);
}

function renderAttention(flagged) {
  const el = $("attention");
  if (!el) return;
  if (!flagged.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "";
  const rank = { warn: 1, near: 2, bad: 3 };
  flagged.sort((a, b) => rank[b.cls] - rank[a.cls]);
  el.innerHTML = `<span class="att-head">⚠ NEEDS ATTENTION</span>` +
    flagged.map((f) => `<span class="att-item ${f.cls}">${f.group} · ${f.label}` +
      (f.st && f.st.dpct != null ? ` ${f.st.dpct >= 0 ? "+" : ""}${f.st.dpct.toFixed(1)}%` : "") + `</span>`).join("");
}

// Dismissed streams are hidden (not deleted — streams are discovered from disk) and
// persisted, so they stay hidden across refreshes/rescans; restore from the dropdown.
const HIDDEN_KEY = "luthiscope.hiddenStreams";
function loadHidden() { try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]")); } catch (e) { return new Set(); } }
function saveHidden() { try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds])); } catch (e) {} }
let hiddenIds = loadHidden();
// "Permanent delete" = forget from the menu (never touches files). Stored as
// id -> record count at delete time; if the run's record count later changes (it
// came back to life), it reappears.
const FORGOT_KEY = "luthiscope.forgottenStreams";
function loadForgot() { try { return JSON.parse(localStorage.getItem(FORGOT_KEY) || "{}"); } catch (e) { return {}; } }
function saveForgot() { try { localStorage.setItem(FORGOT_KEY, JSON.stringify(forgotten)); } catch (e) {} }
let forgotten = loadForgot();
let allStreams = [];
// batch hide (Brian, 2026-07-25): per-stream checkboxes + the trash square under
// the collapse toggle. Session-only selection — hiding persists, selection doesn't.
let selectedIds = new Set();
function updateClearSelected() {
  const btn = $("clear-selected");
  if (!btn) return;
  btn.disabled = selectedIds.size === 0;
  btn.title = selectedIds.size ? `Hide ${selectedIds.size} selected stream(s)` : "Hide selected streams";
}

async function loadStreams() {
  const list = $("stream-list");
  list.innerHTML = "<li class='s-meta'>scanning…</li>";
  try {
    allStreams = await (await fetch("/api/streams")).json();
  } catch (e) {
    allStreams = [];
    list.innerHTML = "<li class='s-meta'>backend unreachable</li>";
    return;
  }
  renderStreamList();
}

function renderStreamList() {
  // reconcile permanently-deleted streams: stay gone unless the run changed
  let forgotChanged = false;
  const suppressed = new Set();
  for (const s of allStreams) {
    if (s.id in forgotten) {
      if (s.n_records === forgotten[s.id]) suppressed.add(s.id);
      else { delete forgotten[s.id]; forgotChanged = true; }
    }
  }
  if (forgotChanged) saveForgot();
  const list = $("stream-list");
  list.innerHTML = "";
  const visible = allStreams.filter((s) => !hiddenIds.has(s.id) && !suppressed.has(s.id));
  const hiddenStreams = allStreams.filter((s) => hiddenIds.has(s.id) && !suppressed.has(s.id));
  if (!allStreams.length) {
    list.innerHTML = "<li class='s-meta'>no streams found in runs dir</li>";
  } else if (!visible.length) {
    list.innerHTML = "<li class='s-meta'>all streams hidden</li>";
  }
  // drop selections for streams that are no longer in the visible list
  const visibleIds = new Set(visible.map((s) => s.id));
  for (const id of [...selectedIds]) if (!visibleIds.has(id)) selectedIds.delete(id);
  for (const s of visible) {
    const li = document.createElement("li");
    const check = document.createElement("input");
    check.type = "checkbox"; check.className = "s-check";
    check.title = "Select for batch hide";
    check.checked = selectedIds.has(s.id);
    check.onclick = (e) => e.stopPropagation();   // don't also select the stream
    check.onchange = () => {
      if (check.checked) selectedIds.add(s.id); else selectedIds.delete(s.id);
      updateClearSelected();
    };
    const main = document.createElement("div");
    main.className = "s-main";
    const liveDot = s.live ? `<span class="live-dot" title="actively logging">●</span>` : "";
    main.innerHTML =
      `<div class="s-name">${liveDot}${s.run_dir}<span class="kind-tag kind-${s.kind}">${s.kind}</span></div>` +
      `<div class="s-meta">${s.n_records} records</div>`;
    main.onclick = () => selectStream(s.id, s.kind, li);
    const trash = document.createElement("button");
    trash.className = "s-trash"; trash.title = "Hide this stream"; trash.textContent = "🗑";
    trash.onclick = (e) => { e.stopPropagation(); hiddenIds.add(s.id); saveHidden(); renderStreamList(); };
    li.appendChild(check); li.appendChild(main); li.appendChild(trash);
    list.appendChild(li);
  }
  const clearBtn = $("clear-all");
  if (clearBtn) clearBtn.style.display = visible.length ? "" : "none";
  updateClearSelected();
  renderHidden(hiddenStreams);
}

function renderHidden(hiddenStreams) {
  const wrap = $("hidden-wrap");
  if (!wrap) return;
  if (!hiddenStreams.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML =
    `<details class="hidden-dd"><summary>Hidden (${hiddenStreams.length})</summary>` +
    `<ul class="hidden-list"></ul><button class="restore-all">restore all</button></details>`;
  const hl = wrap.querySelector(".hidden-list");
  for (const s of hiddenStreams) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "s-hidden-name";
    name.textContent = `${s.run_dir} · ${s.kind}`;
    const restore = document.createElement("button");
    restore.className = "s-restore"; restore.title = "Restore"; restore.textContent = "↩";
    restore.onclick = () => { hiddenIds.delete(s.id); saveHidden(); renderStreamList(); };
    const del = document.createElement("button");
    del.className = "s-delete"; del.title = "Delete from list (returns only if the run changes)"; del.textContent = "✕";
    del.onclick = () => { forgotten[s.id] = s.n_records; saveForgot(); hiddenIds.delete(s.id); saveHidden(); renderStreamList(); };
    li.appendChild(name); li.appendChild(restore); li.appendChild(del);
    hl.appendChild(li);
  }
  wrap.querySelector(".restore-all").onclick = () => {
    for (const s of hiddenStreams) hiddenIds.delete(s.id);
    saveHidden(); renderStreamList();
  };
}

async function selectStream(id, kind, li) {
  document.querySelectorAll("#stream-list li").forEach((el) => el.classList.remove("active"));
  if (li) li.classList.add("active");
  current = { id, kind };
  if (ws) { ws._deliberate = true; ws.close(); ws = null; }

  $("now-line").innerHTML = `loading <b>${id}</b> …`;
  const resp = await (await fetch(`/api/streams/${id}/records`)).json();
  records = resp.records || [];
  buildPanels(kind);
  refreshData();
  $("now-line").innerHTML = `<b>${id}</b> · ${records.length} records · ${kind}`;
  setConn("online", "LOADED");
  openLive(id);
}

// Auto-reconnect (2026-07-18): a dropped socket used to flip the dot to
// OFFLINE and give up forever — a vitals display that silently freezes
// while looking calm. Now a lost connection retries with backoff, and on
// reconnect re-fetches history first so records missed while dark are
// recovered (the server tail streams appended-after-connect only).
let reconnectDelay = 2000;
let reconnectTimer = null;

function scheduleReconnect(id, kind) {
  if (reconnectTimer) return;
  setConn("offline", `RECONNECTING in ${Math.round(reconnectDelay / 1000)}s`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!current || current.id !== id) return;  // user moved on
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    await selectStream(id, kind, document.querySelector("#stream-list li.active"));
  }, reconnectDelay);
}

function openLive(id) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/streams/${id}`);
  ws.onopen = () => { reconnectDelay = 2000; setConn("live", "LIVE"); };
  ws.onclose = (ev) => {
    if (ev.target._deliberate) return;
    if (current && current.id === id) scheduleReconnect(id, current.kind);
    else setConn("offline", "OFFLINE");
  };
  ws.onerror = () => setConn("offline", "OFFLINE");
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.records && msg.records.length) {
      records = records.concat(msg.records);
      refreshData();
      $("now-line").innerHTML = `<b>${id}</b> · ${records.length} records · ${current.kind} · live`;
    }
  };
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitCharts, 120);
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") restoreMaximized(); });

// ---- settings panel ----
const SETTINGS_SCHEMA = [
  { cat: "Background Simulation" },
  { type: "checkbox", key: "enabled", label: "Enabled" },
  { type: "select", key: "quality", label: "Quality", parse: Number,
    options: [["64", "Low"], ["96", "Medium"], ["128", "High"]] },
  { type: "select", key: "palette", label: "Palette",
    options: [["aurora", "Aurora"], ["ember", "Ember"], ["ice", "Ice"], ["spectrum", "Spectrum"], ["mono", "Mono"]] },
  { type: "range", key: "intensity", label: "Intensity", min: 0.3, max: 2, step: 0.1 },
  { type: "range", key: "trail", label: "Trail length", min: 0.95, max: 0.996, step: 0.002 },
  { type: "range", key: "clickCount", label: "Objects per click", min: 0, max: 5, step: 1, parse: Number, note: "0 = off" },
  { type: "range", key: "clickMax", label: "Max click objects", min: 0, max: 5, step: 1, parse: Number, note: "concurrent cap" },
  { type: "range", key: "autoObjects", label: "Continuous objects", min: 0, max: 5, step: 1, parse: Number, note: "0 = off" },
  { type: "range", key: "edgeEmit", label: "Edge emitters", min: 0, max: 4, step: 1, parse: Number, note: "0 = off" },
  { type: "checkbox", key: "cursorEmit", label: "Cursor emits fluid" },
  { cat: "Liquid Behavior" },
  { type: "range", key: "vorticity", label: "Swirl (vorticity)", min: 0, max: 20, step: 0.5, note: "0 = laminar" },
  { type: "range", key: "simSpeed", label: "Flow speed", min: 0.5, max: 2, step: 0.05 },
  { type: "range", key: "plumeSize", label: "Plume size", min: 1, max: 4, step: 1, parse: Number },
  { type: "range", key: "stirStrength", label: "Stir strength", min: 0.05, max: 0.5, step: 0.01, note: "objects push the fluid" },
  { type: "range", key: "objSpeed", label: "Launch speed", min: 0.5, max: 2, step: 0.05 },
  { type: "range", key: "objDrag", label: "Object drag", min: 0.01, max: 0.1, step: 0.005, note: "higher = shorter-lived" },
];

// Settings rework (2026-07-19, Brian): the gear now opens a general
// SETTINGS menu -- Data Source (runs-folder picker, native dialog in the
// desktop app) plus an entry that opens the Background Simulation panel
// as its own sub-page.
async function buildSettings() {
  const panel = $("settings-panel");
  if (!panel) return;
  let cfgNow = { runs_dir: "(unavailable)" };
  try { cfgNow = await (await fetch("/api/config")).json(); } catch (e) {}
  const inDesktop = !!(window.pywebview && window.pywebview.api);
  let html = `<div class="settings-head">SETTINGS<button id="settings-close">✕</button></div>`;
  html += `<div class="settings-cat">Data Source</div>`;
  html += `<div class="set-row col"><div class="set-rowtop"><span>Training runs folder</span></div>` +
          `<input type="text" id="runs-dir-input" value="${cfgNow.runs_dir.replace(/"/g, "&quot;")}" spellcheck="false" style="width:100%">` +
          `<div class="set-rowtop" style="margin-top:6px">` +
          (inDesktop ? `<button id="runs-dir-browse">Browse…</button>` : `<span style="opacity:.6;font-size:11px">type a path (Browse needs the desktop app)</span>`) +
          `<button id="runs-dir-apply">Apply</button></div>` +
          `<div id="runs-dir-status" style="font-size:11px;opacity:.75;margin-top:4px"></div></div>`;
  html += `<div class="settings-cat">Display</div>`;
  html += `<div class="set-row"><span>Metric panels</span><button id="open-metric-settings">Open ›</button></div>`;
  html += `<div class="settings-cat">Appearance</div>`;
  html += `<div class="set-row"><span>Background simulation</span><button id="open-bg-settings">Open ›</button></div>`;
  panel.innerHTML = html;
  $("settings-close").onclick = () => panel.classList.remove("open");
  $("open-metric-settings").onclick = () => buildMetricSettings();
  $("runs-dir-apply").onclick = async () => {
    const val = $("runs-dir-input").value.trim();
    const st = $("runs-dir-status");
    st.textContent = "applying…";
    try {
      const resp = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs_dir: val }),
      });
      const data = await resp.json();
      if (!resp.ok) { st.textContent = "✗ " + (data.detail || "invalid folder"); return; }
      st.textContent = `✓ ${data.streams_found} stream(s) found` + (data.persisted ? " · saved" : "");
      loadStreams();
    } catch (e) { st.textContent = "✗ " + e; }
  };
  const browse = $("runs-dir-browse");
  if (browse) browse.onclick = async () => {
    try {
      const picked = await window.pywebview.api.pick_folder();
      if (picked) { $("runs-dir-input").value = picked; $("runs-dir-apply").click(); }
    } catch (e) { $("runs-dir-status").textContent = "✗ " + e; }
  };
  $("open-bg-settings").onclick = () => buildBgSettings();
}

// Metric selection sub-page: every category/panel/metric in GROUPS, with a
// master checkbox per category. Deselecting hides a metric even when its data
// exists; panels with no data auto-hide regardless (so most of the universal
// catalog is invisible until a run actually emits those keys).
function buildMetricSettings() {
  const panel = $("settings-panel");
  if (!panel) return;
  const KIND_LABEL = { training: "Training", cognition: "Cognition" };
  // live-dot per metric: green pulse = this metric has data in the loaded
  // stream right now (Brian, 2026-07-25). Shown regardless of checkbox state,
  // so a disabled-but-active metric is findable without trial and error.
  const kindActive = (kind) => current && current.kind === kind && records.length > 0;
  const dot = `<span class="live-dot" title="data present in the loaded stream">●</span>`;
  const seriesLive = (kind, s) => kindActive(kind) && records.some((r) => s.get(r) != null);
  const heatmapLive = (kind, p) => kindActive(kind) && records.some(p.has);
  let html = `<div class="settings-head"><button id="settings-back" title="back">‹</button>METRIC PANELS<button id="settings-close">✕</button></div>`;
  html += `<div class="set-note">Unchecked metrics stay hidden even when present in the stream. Panels whose data is absent from the current stream auto-hide — turn on the switch below to render them anyway as empty shells. A pulsing green dot marks metrics with data in the loaded stream.</div>`;
  html += `<label class="set-row"><span>Show panels without data</span><input type="checkbox" id="show-empty-panels" ${showEmptyPanels ? "checked" : ""}></label>`;
  for (const kind in GROUPS) {
    html += `<div class="settings-cat">${KIND_LABEL[kind] || kind} metrics</div>`;
    for (const grp of GROUPS[kind].groups) {
      const ids = grp.panels.flatMap((p) => p.type === "heatmap"
        ? [metricId(kind, grp.title, p.title, "*")]
        : p.series.map((s) => metricId(kind, grp.title, p.title, s.label)));
      const on = ids.filter(metricEnabled).length;
      html += `<div class="set-group"><label class="set-group-head">` +
        `<input type="checkbox" class="cat-master" data-kind="${kind}" data-group="${grp.title}"` +
        ` ${on === ids.length ? "checked" : ""} ${on > 0 && on < ids.length ? "data-mixed=1" : ""}>` +
        `<b>${grp.title}</b></label></div>`;
      for (const p of grp.panels) {
        if (p.type === "heatmap") {
          const id = metricId(kind, grp.title, p.title, "*");
          html += `<label class="set-metric"><input type="checkbox" data-mid="${id.replace(/"/g, "&quot;")}"` +
            ` ${metricEnabled(id) ? "checked" : ""}><span>${heatmapLive(kind, p) ? dot : ""}${p.title}</span><em>heatmap</em></label>`;
        } else {
          for (const s of p.series) {
            const id = metricId(kind, grp.title, p.title, s.label);
            html += `<label class="set-metric"><input type="checkbox" data-mid="${id.replace(/"/g, "&quot;")}"` +
              ` ${metricEnabled(id) ? "checked" : ""}><span>${seriesLive(kind, s) ? dot : ""}${s.label}</span><em>${p.title}</em></label>`;
          }
        }
      }
    }
  }
  panel.innerHTML = html;
  panel.querySelectorAll(".cat-master[data-mixed]").forEach((el) => { el.indeterminate = true; });
  // same explanations as the dashboard panels, on the metric rows here
  panel.querySelectorAll(".set-metric").forEach((row) => {
    const box = row.querySelector("[data-mid]");
    if (!box) return;
    const [, group, panelTitle] = box.dataset.mid.split("|");
    const desc = PANEL_DESCS[`${group}|${panelTitle}`];
    if (desc) attachDesc(row, desc);
  });
  const rebuild = () => { if (current) { buildPanels(current.kind); refreshData(); } };
  $("show-empty-panels").addEventListener("change", (e) => {
    showEmptyPanels = e.target.checked;
    try { localStorage.setItem(SHOW_EMPTY_KEY, showEmptyPanels ? "1" : "0"); } catch (err) {}
    rebuild();
  });
  panel.querySelectorAll("[data-mid]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.mid;
      if (el.checked) disabledMetrics.delete(id); else disabledMetrics.add(id);
      saveDisabledMetrics(); rebuild();
      // keep the category master's state honest without a full re-render
      const [kind, group] = id.split("|");
      const master = panel.querySelector(`.cat-master[data-kind="${kind}"][data-group="${group}"]`);
      if (master) {
        const boxes = [...panel.querySelectorAll("[data-mid]")].filter((b) => b.dataset.mid.startsWith(`${kind}|${group}|`));
        const on = boxes.filter((b) => b.checked).length;
        master.checked = on === boxes.length;
        master.indeterminate = on > 0 && on < boxes.length;
      }
    });
  });
  panel.querySelectorAll(".cat-master").forEach((el) => {
    el.addEventListener("change", () => {
      const { kind, group } = el.dataset;
      el.indeterminate = false;
      panel.querySelectorAll("[data-mid]").forEach((b) => {
        if (!b.dataset.mid.startsWith(`${kind}|${group}|`)) return;
        b.checked = el.checked;
        if (el.checked) disabledMetrics.delete(b.dataset.mid); else disabledMetrics.add(b.dataset.mid);
      });
      saveDisabledMetrics(); rebuild();
    });
  });
  $("settings-back").onclick = () => buildSettings();
  $("settings-close").onclick = () => panel.classList.remove("open");
}

function buildBgSettings() {
  const panel = $("settings-panel");
  if (!panel || !window.LuthiBG) return;
  const cfg = window.LuthiBG.cfg;
  let html = `<div class="settings-head"><button id="settings-back" title="back">‹</button>BACKGROUND<button id="settings-close">✕</button></div>`;
  for (const it of SETTINGS_SCHEMA) {
    if (it.cat) { html += `<div class="settings-cat">${it.cat}</div>`; continue; }
    const val = cfg[it.key];
    if (it.type === "checkbox") {
      html += `<label class="set-row"><span>${it.label}</span><input type="checkbox" data-key="${it.key}" ${val ? "checked" : ""}></label>`;
    } else if (it.type === "select") {
      const opts = it.options.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${l}</option>`).join("");
      html += `<label class="set-row"><span>${it.label}</span><select data-key="${it.key}">${opts}</select></label>`;
    } else if (it.type === "range") {
      html += `<div class="set-row col"><div class="set-rowtop"><span>${it.label}${it.note ? ` <em>${it.note}</em>` : ""}</span><b data-val="${it.key}">${val}</b></div>` +
              `<input type="range" data-key="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}" value="${val}"></div>`;
    }
  }
  panel.innerHTML = html;
  $("settings-back").onclick = () => buildSettings();
  panel.querySelectorAll("[data-key]").forEach((el) => {
    const key = el.dataset.key;
    const meta = SETTINGS_SCHEMA.find((s) => s.key === key);
    const apply = () => {
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (el.type === "range") v = meta.parse ? meta.parse(el.value) : parseFloat(el.value);
      else v = meta.parse ? meta.parse(el.value) : el.value;
      window.LuthiBG.set(key, v);
      const disp = panel.querySelector(`[data-val="${key}"]`);
      if (disp) disp.textContent = v;
    };
    el.addEventListener(el.type === "range" ? "input" : "change", apply);
  });
  $("settings-close").onclick = () => panel.classList.remove("open");
}

// collapsible streams rail (Brian, 2026-07-25): slides into the window edge —
// not an overlay like settings — with the LuthiWorks logo staying in the corner.
const SIDEBAR_KEY = "luthiscope.sidebarCollapsed";
const sideEl = $("sidebar"), sideBtn = $("sidebar-toggle");
function applySidebar(collapsed) {
  sideEl.classList.toggle("collapsed", collapsed);
  if (sideBtn) {
    sideBtn.textContent = collapsed ? "⟩" : "⟨";
    sideBtn.title = collapsed ? "Expand streams panel" : "Collapse streams panel";
  }
  setTimeout(fitCharts, 240);   // charts take over the freed width after the slide
}
if (sideBtn && sideEl) {
  sideBtn.onclick = () => {
    const c = !sideEl.classList.contains("collapsed");
    try { localStorage.setItem(SIDEBAR_KEY, c ? "1" : "0"); } catch (e) {}
    applySidebar(c);
  };
  try { if (localStorage.getItem(SIDEBAR_KEY) === "1") applySidebar(true); } catch (e) {}
}

$("refresh").onclick = loadStreams;
const clearSelBtn = $("clear-selected");
if (clearSelBtn) clearSelBtn.onclick = () => {
  if (!selectedIds.size) return;
  for (const id of selectedIds) hiddenIds.add(id);
  selectedIds.clear();
  saveHidden(); renderStreamList();
};
const clearAllBtn = $("clear-all");
if (clearAllBtn) clearAllBtn.onclick = () => {
  for (const s of allStreams) if (!hiddenIds.has(s.id)) hiddenIds.add(s.id);
  saveHidden(); renderStreamList();
};
const sBtn = $("settings-btn");
if (sBtn) sBtn.onclick = () => {
  const panel = $("settings-panel");
  if (!panel.classList.contains("open")) buildSettings();
  panel.classList.toggle("open");
};
loadStreams();
