import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

const tracks = [
  { time: '22:00', title: 'Midnight City', artist: 'Neon Synth', bpm: 124 },
  { time: '22:04', title: 'Laser Grid', artist: 'DJ Flux', bpm: 126 },
  { time: '22:08', title: 'Cyber Pulse', artist: 'The Architect', bpm: 128 },
  { time: '22:12', title: 'Hyperdrive', artist: 'Vector', bpm: 128 },
];

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500), 
      setTimeout(() => setPhase(2), 1500), 
      setTimeout(() => setPhase(3), 3000), 
      setTimeout(() => setPhase(4), 6000), 
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
    >
      <div className="w-[40%] z-10 relative">
        <motion.div 
          className="w-16 h-2 bg-[#ff00d4] mb-6 box-glow-magenta"
          initial={{ scaleX: 0 }}
          animate={phase >= 1 ? { scaleX: 1 } : { scaleX: 0 }}
          style={{ originX: 0 }}
          transition={{ duration: 0.5 }}
        />
        <motion.h2 
          className="text-[4vw] font-bold leading-tight mb-4 text-glow-cyan uppercase"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          SMART<br/>ROTATION
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-white/70 uppercase tracking-wide"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          Perfect pacing.<br/>Flawless transitions.<br/><span className="text-[#00f0ff]">Zero downtime.</span>
        </motion.p>
      </div>

      <div className="w-[50%] z-10 relative">
        <motion.div 
          className="bg-black/80 border-2 border-[#00f0ff]/50 p-8 rounded-xl backdrop-blur-xl box-glow-cyan"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <motion.div 
            className="flex items-center gap-4 mb-6 border-b border-[#00f0ff]/30 pb-4"
            initial={{ opacity: 0 }}
            animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          >
            <div className="w-3 h-3 rounded-full bg-[#ff00d4] animate-pulse box-glow-magenta" />
            <span className="font-mono text-[#ff00d4] tracking-widest text-xl">LIVE QUEUE // MAIN ROOM</span>
          </motion.div>

          <div className="space-y-4">
            {tracks.map((track, i) => (
              <motion.div 
                key={i}
                className={`flex items-center justify-between p-4 rounded-lg ${i === 0 ? 'bg-[#00f0ff]/20 border-l-4 border-[#00f0ff]' : 'bg-white/5 border-l-4 border-transparent'}`}
                initial={{ opacity: 0, x: 50 }}
                animate={phase >= 3 ? { 
                  opacity: i === 0 ? 1 : 0.5, 
                  x: 0,
                  y: phase >= 4 && i === 0 ? -100 : 0
                } : { opacity: 0, x: 50 }}
                transition={{ delay: phase >= 3 && phase < 4 ? i * 0.15 : 0, type: 'spring', stiffness: 250, damping: 25 }}
              >
                <div className="flex items-center gap-6">
                  <span className="font-mono text-white/50 text-xl">{track.time}</span>
                  <div>
                    <div className="font-bold text-2xl tracking-wide">{track.title}</div>
                    <div className="text-white/50 text-lg uppercase">{track.artist}</div>
                  </div>
                </div>
                <div className="font-mono text-[#00f0ff] text-xl">{track.bpm} BPM</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
