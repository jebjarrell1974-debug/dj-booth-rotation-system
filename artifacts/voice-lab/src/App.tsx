import { useState, useRef, useEffect } from "react";

const BASE = import.meta.env.BASE_URL;

const MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (what 003 uses now)" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5 (fast, less expressive)" },
  { id: "eleven_v3", label: "v3 (alpha — most expressive, supports audio tags)" },
] as const;

type Settings = {
  model_id: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
};

const V3 = "eleven_v3";

const FIVE_PRESETS: Array<{ name: string; emoji: string; description: string; sample: string; settings: Settings }> = [
  {
    name: "Smooth Seducer",
    emoji: "🌙",
    description: "Low & velvety. Slow pace. Late-night intimate energy.",
    sample: "Fellas… she's everything you've been thinking about since you walked in. Let her take your night somewhere real special… Cherry…",
    settings: {
      model_id: V3,
      stability: 0.35,
      similarity_boost: 0.85,
      style: 0.65,
      speed: 0.95,
      use_speaker_boost: true,
    },
  },
  {
    name: "Hype Man",
    emoji: "🔥",
    description: "Explosive. Fast & punchy. Makes the room physically react.",
    sample: "[excited] Make some noise, fellas! [shouts] She is about to set this stage on FIRE — get those dollars ready — coming to the main stage right now — Cherry!",
    settings: {
      model_id: V3,
      stability: 0.10,
      similarity_boost: 0.80,
      style: 0.90,
      speed: 1.30,
      use_speaker_boost: true,
    },
  },
  {
    name: "Comedian",
    emoji: "🤣",
    description: "Playful. Bar-talk. Feels unscripted. Lightly calls out the room.",
    sample: "Alright, alright — stop pretending to watch the game, guys. I see y'all. The real show is about to start. Coming to the main stage… Cherry.",
    settings: {
      model_id: V3,
      stability: 0.25,
      similarity_boost: 0.85,
      style: 0.60,
      speed: 1.20,
      use_speaker_boost: true,
    },
  },
  {
    name: "Dramatic Build",
    emoji: "🎭",
    description: "Suspense. Long pauses. Name drops like a headline event.",
    sample: "[whispers] Gentlemen… I need you to pay attention right now. [pause] Something special is heading to this stage. [shouts] The one… the only… Cherry.",
    settings: {
      model_id: V3,
      stability: 0.20,
      similarity_boost: 0.90,
      style: 0.95,
      speed: 0.90,
      use_speaker_boost: true,
    },
  },
  {
    name: "Commander",
    emoji: "📻",
    description: "Radio-polished. Short sentences. Total authority. FM meets fight night.",
    sample: "Main stage. Right now. She came to work tonight and she's worth every dollar. The one and only… Cherry.",
    settings: {
      model_id: V3,
      stability: 0.40,
      similarity_boost: 0.90,
      style: 0.70,
      speed: 1.15,
      use_speaker_boost: true,
    },
  },
];

const PRESET_003: Settings = {
  model_id: "eleven_multilingual_v2",
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.40,
  speed: 1.0,
  use_speaker_boost: true,
};

type ColumnState = {
  settings: Settings;
  voice_id: string;
  audioUrl: string | null;
  loading: boolean;
  error: string | null;
  lastDuration: number | null;
  presetName: string | null;
};

function newColumn(settings: Settings, presetName: string | null = null, voice_id = ""): ColumnState {
  return {
    settings: { ...settings },
    voice_id,
    audioUrl: null,
    loading: false,
    error: null,
    lastDuration: null,
    presetName,
  };
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs uppercase tracking-wider text-cyan-400/80">{label}</label>
        <span className="text-xs font-mono text-cyan-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-500"
      />
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function VoiceColumn({
  title,
  accent,
  state,
  setState,
  text,
}: {
  title: string;
  accent: "cyan" | "fuchsia";
  state: ColumnState;
  setState: (updater: (s: ColumnState) => ColumnState) => void;
  text: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const generate = async () => {
    if (!text.trim()) {
      setState((s) => ({ ...s, error: "Type some text first" }));
      return;
    }
    const startedAt = performance.now();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(`${BASE}api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice_id: state.voice_id || undefined,
          model_id: state.settings.model_id,
          voice_settings: {
            stability: state.settings.stability,
            similarity_boost: state.settings.similarity_boost,
            style: state.settings.style,
            speed: state.settings.speed,
            use_speaker_boost: state.settings.use_speaker_boost,
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const elapsed = Math.round(performance.now() - startedAt);
      setState((s) => {
        if (s.audioUrl) URL.revokeObjectURL(s.audioUrl);
        return { ...s, loading: false, audioUrl: url, lastDuration: elapsed };
      });
      setTimeout(() => audioRef.current?.play().catch(() => {}), 80);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  };

  const update = (patch: Partial<Settings>) =>
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch }, presetName: null }));

  const accentBorder = accent === "cyan" ? "border-cyan-500/40" : "border-fuchsia-500/40";
  const accentHeader = accent === "cyan" ? "text-cyan-400" : "text-fuchsia-400";
  const accentBtn =
    accent === "cyan"
      ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
      : "bg-fuchsia-500 hover:bg-fuchsia-400 text-slate-950";

  return (
    <div className={`rounded-xl border ${accentBorder} bg-slate-900/60 p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className={`text-sm font-bold uppercase tracking-widest ${accentHeader}`}>{title}</h2>
        <div className="flex items-center gap-2">
          {state.presetName && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-600">
              {state.presetName}
            </span>
          )}
          {state.lastDuration !== null && (
            <span className="text-[10px] text-slate-500 font-mono">{state.lastDuration}ms</span>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wider text-cyan-400/80">Voice ID</label>
        <input
          type="text"
          value={state.voice_id}
          onChange={(e) => setState((s) => ({ ...s, voice_id: e.target.value }))}
          placeholder="leave blank to use ELEVENLABS_VOICE_ID secret"
          className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
        />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wider text-cyan-400/80">Model</label>
        <select
          value={state.settings.model_id}
          onChange={(e) => update({ model_id: e.target.value })}
          className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <Slider label="Stability" value={state.settings.stability} min={0} max={1} step={0.05}
        onChange={(v) => update({ stability: v })}
        hint="Lower = more variable/expressive. Higher = more consistent/monotone." />
      <Slider label="Similarity boost" value={state.settings.similarity_boost} min={0} max={1} step={0.05}
        onChange={(v) => update({ similarity_boost: v })}
        hint="How closely to match the original voice." />
      <Slider label="Style" value={state.settings.style} min={0} max={1} step={0.05}
        onChange={(v) => update({ style: v })}
        hint="Emotional range. Higher = more dramatic. THIS IS THE BIG ONE." />
      <Slider label="Speed" value={state.settings.speed} min={0.7} max={1.5} step={0.05}
        onChange={(v) => update({ speed: v })}
        hint="ElevenLabs may clamp >1.2 depending on model. Push it and see." />

      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={state.settings.use_speaker_boost}
          onChange={(e) => update({ use_speaker_boost: e.target.checked })}
          className="accent-cyan-500"
        />
        Speaker boost
      </label>

      <button
        onClick={generate}
        disabled={state.loading}
        className={`w-full py-2.5 rounded font-bold uppercase tracking-wider text-sm transition-colors ${accentBtn} disabled:opacity-50 disabled:cursor-wait`}
      >
        {state.loading ? "Generating…" : "Generate & play"}
      </button>

      {state.error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded p-2 whitespace-pre-wrap font-mono">
          {state.error}
        </div>
      )}

      {state.audioUrl && (
        <audio ref={audioRef} src={state.audioUrl} controls className="w-full" />
      )}
    </div>
  );
}

function App() {
  const [text, setText] = useState(FIVE_PRESETS[0].sample);
  const [colA, setColA] = useState<ColumnState>(() => newColumn(FIVE_PRESETS[0].settings, FIVE_PRESETS[0].name));
  const [colB, setColB] = useState<ColumnState>(() => newColumn(FIVE_PRESETS[1].settings, FIVE_PRESETS[1].name));

  useEffect(() => {
    return () => {
      if (colA.audioUrl) URL.revokeObjectURL(colA.audioUrl);
      if (colB.audioUrl) URL.revokeObjectURL(colB.audioUrl);
    };
  }, []);

  const fireFetch = async (
    state: ColumnState,
    setState: (u: (s: ColumnState) => ColumnState) => void,
    overrideText?: string,
  ) => {
    const t = overrideText ?? text;
    setState((s) => ({ ...s, loading: true, error: null }));
    const startedAt = performance.now();
    try {
      const res = await fetch(`${BASE}api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t,
          voice_id: state.voice_id || undefined,
          model_id: state.settings.model_id,
          voice_settings: {
            stability: state.settings.stability,
            similarity_boost: state.settings.similarity_boost,
            style: state.settings.style,
            speed: state.settings.speed,
            use_speaker_boost: state.settings.use_speaker_boost,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const elapsed = Math.round(performance.now() - startedAt);
      setState((s) => {
        if (s.audioUrl) URL.revokeObjectURL(s.audioUrl);
        return { ...s, loading: false, audioUrl: url, lastDuration: elapsed };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  };

  const generateBoth = async () => {
    await Promise.all([fireFetch(colA, setColA), fireFetch(colB, setColB)]);
  };

  const loadPreset = (
    preset: typeof FIVE_PRESETS[0],
    col: "A" | "B",
  ) => {
    const setter = col === "A" ? setColA : setColB;
    setter((s) => ({ ...s, settings: { ...preset.settings }, presetName: preset.name }));
    setText(preset.sample);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        <header className="border-b border-cyan-900/40 pb-4">
          <h1 className="text-2xl font-bold tracking-wider text-cyan-400">ELEVENLABS VOICE LAB</h1>
          <p className="text-xs text-slate-500 mt-1">
            Test only — lives in Replit, never deploys to 003. Load any two presets into A and B, generate, compare.
          </p>
        </header>

        {/* ── 5 Preset Archetypes ── */}
        <section className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-cyan-400/80">5 DJ Archetypes — load into A or B to compare</p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {FIVE_PRESETS.map((p) => (
              <div key={p.name} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-2">
                <div>
                  <p className="text-sm font-bold text-slate-100">{p.emoji} {p.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{p.description}</p>
                </div>
                <div className="text-[10px] font-mono text-slate-500 space-y-0.5">
                  <div>stab <span className="text-slate-300">{p.settings.stability.toFixed(2)}</span></div>
                  <div>style <span className="text-slate-300">{p.settings.style.toFixed(2)}</span></div>
                  <div>speed <span className="text-slate-300">{p.settings.speed.toFixed(2)}</span></div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => loadPreset(p, "A")}
                    className="flex-1 text-[10px] py-1 rounded bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 border border-cyan-800/50 font-bold transition-colors"
                  >
                    → A
                  </button>
                  <button
                    onClick={() => loadPreset(p, "B")}
                    className="flex-1 text-[10px] py-1 rounded bg-fuchsia-950/70 hover:bg-fuchsia-900 text-fuchsia-300 border border-fuchsia-800/50 font-bold transition-colors"
                  >
                    → B
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Also include the current 003 baseline ── */}
        <section className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-slate-500">Also load:</span>
          <button
            onClick={() => {
              setColA((s) => ({ ...s, settings: { ...PRESET_003 }, presetName: "003 current (v2)" }));
              setText("Coming to the main stage, gentlemen, your next entertainer — Cherry. Get those dollars ready.");
            }}
            className="text-[10px] px-2 py-1 rounded bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/50"
          >
            A: 003 current (v2 baseline)
          </button>
          <button
            onClick={() => {
              setColB((s) => ({ ...s, settings: { ...PRESET_003 }, presetName: "003 current (v2)" }));
              setText("Coming to the main stage, gentlemen, your next entertainer — Cherry. Get those dollars ready.");
            }}
            className="text-[10px] px-2 py-1 rounded bg-fuchsia-950/50 hover:bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-800/50"
          >
            B: 003 current (v2 baseline)
          </button>
        </section>

        {/* ── Script input ── */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-cyan-400/80">Line to speak</label>
            <button
              onClick={generateBoth}
              disabled={colA.loading || colB.loading}
              className="px-4 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-colors disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
            >
              Generate both ▶▶
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 resize-y"
            placeholder="Type the line you want to hear…"
          />
          <p className="text-[10px] text-slate-500">
            Loading a preset above auto-fills an example line written for that style. You can edit it freely.
          </p>
        </section>

        {/* ── A/B Columns ── */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <VoiceColumn title="A — Reference" accent="cyan" state={colA} setState={setColA} text={text} />
          <VoiceColumn title="B — Experiment" accent="fuchsia" state={colB} setState={setColB} text={text} />
        </section>

        <footer className="text-xs text-slate-600 border-t border-slate-800 pt-3 space-y-1">
          <p>
            <span className="text-cyan-400">v3 tip:</span> supports inline emotion tags —{" "}
            <code className="text-slate-300">[excited]</code>{" "}
            <code className="text-slate-300">[whispers]</code>{" "}
            <code className="text-slate-300">[shouts]</code>{" "}
            <code className="text-slate-300">[laughs]</code>{" "}
            <code className="text-slate-300">[pause]</code>. Dramatic Build preset uses them.
          </p>
          <p>
            Once you lock down the 5 sounds you want, tell me and I'll bake them into production — with a voice version bump that wipes Solar and Molly's bad cache at the same time.
          </p>
        </footer>

      </div>
    </div>
  );
}

export default App;
