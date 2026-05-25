import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene3() {
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

  // Generate waveform bars
  const bars = Array.from({ length: 40 }).map((_, i) => {
    // create a realistic looking waveform shape
    const centerDist = Math.abs(i - 20) / 20;
    const baseHeight = 100 * (1 - centerDist * centerDist);
    return { baseHeight };
  });

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black px-[10vw]"
      initial={{ clipPath: 'inset(100% 0 0 0)' }}
      animate={{ clipPath: 'inset(0% 0 0 0)' }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 overflow-hidden z-0 flex items-center justify-center opacity-30">
         <motion.div 
           className="w-[120vw] h-[20vw] border-t border-b border-[#ff00d4]/40"
           animate={{ rotateZ: [0, 5, -5, 0], scaleY: [1, 1.5, 0.8, 1] }}
           transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
         />
      </div>

      <div className="text-center relative z-10 mb-16">
        <motion.h2 
          className="text-[5vw] font-bold leading-tight mb-4 text-glow-magenta uppercase text-[#ff00d4]"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          AI VOICEOVERS
        </motion.h2>
        <motion.p 
          className="text-[2vw] text-white/70 uppercase tracking-widest font-mono"
          initial={{ opacity: 0 }}
          animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          HYPER-REALISTIC ANNOUNCEMENTS
        </motion.p>
      </div>

      <div className="relative w-full max-w-5xl h-64 flex items-center justify-center gap-2 z-10">
        {bars.map((bar, i) => (
          <motion.div
            key={i}
            className="w-4 rounded-full bg-[#00f0ff] box-glow-cyan"
            initial={{ height: 10 }}
            animate={phase >= 3 ? {
              height: [
                10, 
                bar.baseHeight * (0.5 + Math.random() * 0.8), 
                bar.baseHeight * (0.3 + Math.random() * 1.2), 
                bar.baseHeight * (0.6 + Math.random() * 0.6), 
                10
              ],
            } : { height: 10 }}
            transition={{
              duration: 2.5,
              ease: "easeInOut",
              times: [0, 0.2, 0.5, 0.8, 1],
              repeat: Infinity,
              repeatType: "mirror",
              delay: Math.random() * 0.2
            }}
          />
        ))}
      </div>

      <motion.div 
        className="absolute bottom-[15vh] bg-[#ff00d4]/10 border border-[#ff00d4]/50 px-8 py-4 rounded-full backdrop-blur-md box-glow-magenta z-10"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <p className="text-2xl font-mono text-white tracking-wider">
          <span className="text-[#ff00d4]">SYSTEM:</span> "GIVE IT UP FOR THE BRIDE TO BE, SARAH!"
        </p>
      </motion.div>
    </motion.div>
  );
}
