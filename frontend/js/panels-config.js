import { C, num } from './utils.js';

// Panel/series spec: which metrics get a panel, colors, health polarity. Split from app.js 2026-09-29.


// each series declares which direction is "healthy" so momentum can be colored
// (good: "up" | "down" | null). null = no health claim (ambiguous metric).
// Grouped metric config. Panels whose series have no data are auto-hidden, so the
// "(when emitted)" panels below appear automatically once the producer starts
// emitting those fields (see the shortlist in the metrics discussion).
export const GROUPS = {
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
        // VISReg replacement era (2026-08-11): l_sigreg is null in these
        // runs and the regularizer's decomposition lives here instead.
        // Auto-hidden until a VISReg arm emits the fields.
        { title: "VISREG (when emitted)", series: [
          { label: "l_visreg", color: C.blue, good: "down", get: (r) => num(r.l_visreg) },
          { label: "shape", color: C.purple, good: "down", get: (r) => num(r.l_vis_shape) },
          { label: "center", color: C.orange, good: "down", get: (r) => num(r.l_vis_center) },
          { label: "scale", color: C.teal, good: "down", get: (r) => num(r.l_vis_scale) },
        ]},
        // Heldout eval fires only at epoch boundaries, so this series is
        // a handful of points across a 72k-step run: sparse=true draws
        // visible markers and the line spans the null gaps. The LM-era
        // val_loss / probe_acc keys were removed 2026-07-21 -- no JEPA
        // log ever emits them, so the tiles read "no data" forever and
        // the (invisible) sparse heldout points made the whole panel
        // look dead (Brian's report).
        { title: "HELDOUT EVAL · NMSE is the guard's gauge", sparse: true, marks: "epoch", series: [
          { label: "heldout_l_pred", color: C.orange, good: "down", get: (r) => num(r.heldout?.text?.l_pred_mean) },
          { label: "heldout_nmse", color: C.red, good: "down", get: (r) => num(r.heldout?.text?.nmse_mean) },
        ]},
      ]},
      { title: "Language", panels: [
        { title: "PERPLEXITY (when emitted)", series: [
          { label: "perplexity", color: C.orange, good: "down", get: (r) => { const v = num(r.light?.l_ntp ?? r.l_ntp); return v == null ? null : Math.exp(v); } },
        ]},
      ]},
      { title: "Optimization", panels: [
        { title: "GRADIENT NORM (when emitted)", series: [
          { label: "grad_norm", color: C.orange, good: null, get: (r) => num(r.grad_norm) },
        ]},
        { title: "LEARNING RATE (when emitted)", marks: false, series: [
          { label: "lr", color: C.teal, good: null, get: (r) => num(r.lr) },
        ]},
        { title: "PLASTICITY TAPER (when emitted)", marks: false, series: [
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
          // 2026-09-29: added the per-block collapse trio (effective_rank,
          // top_dir_share, chorus_eff_rank -- emitted since 2026-08-14 but
          // never selectable here) and the contribution pair
          // (contrib_var_ratio, contrib_chorus -- emitted since 2026-09-29;
          // what the block ADDS, not what it outputs).
          metrics: ["set_point_drift", "update_ema_mean", "precision_mean", "precision_spread", "prediction_norm", "error_acc_mean", "consolidation_fires",
                    "effective_rank", "top_dir_share", "chorus_eff_rank", "contrib_var_ratio", "contrib_chorus"] },
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
          { label: "soloist_share", color: C.red, good: "down", get: (r) => num(r.deep?.top_dir_share) },
          { label: "chorus_rank", color: C.teal, good: "up", get: (r) => num(r.deep?.chorus_stable_rank) },
        ]},
      ]},
      { title: "Throughput", panels: [
        { title: "TOKENS CONSUMED", marks: false, series: [
          { label: "tokens", color: C.green, good: "up", get: (r) => {
            const t = r.tokens_consumed; if (!t) return null;
            let s = 0; for (const k in t) { if (typeof t[k] === "number") s += t[k]; } return s;
          } },
        ]},
        { title: "ELAPSED (hours)", marks: false, series: [
          { label: "elapsed_h", color: C.gray, good: null, get: (r) => num(r.elapsed_seconds) == null ? null : r.elapsed_seconds / 3600 },
        ]},
        { title: "STEP TIME (when emitted)", marks: false, series: [
          { label: "step_time", color: C.orange, good: "down", get: (r) => num(r.step_time ?? r.sec_per_step ?? r.step_seconds) },
        ]},
        { title: "RATE · SAMPLES & TOKENS /s (when emitted)", marks: false, series: [
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
        { title: "GPU MEMORY (when emitted)", marks: false, series: [
          { label: "gpu_mem", color: C.blue, good: null, get: (r) => num(r.gpu_mem_gb ?? r.gpu_memory_gb ?? r.mem_allocated_gb ?? r.gpu_mem) },
        ]},
        { title: "GPU UTILIZATION (when emitted)", marks: false, series: [
          { label: "gpu_util", color: C.green, good: null, get: (r) => num(r.gpu_util ?? r.gpu_utilization) },
        ]},
        { title: "MFU (when emitted)", marks: false, series: [
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
